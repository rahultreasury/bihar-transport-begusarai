/**
 * ClientRepository
 * Database-only repository for offline corporate client operations.
 * Uses Prisma Client for all database operations.
 */

const { prisma } = require('../config/prisma');

/**
 * Retry wrapper for transient Prisma connection errors
 */
async function withRetry(fn, context = 'operation', maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isPrismaConnectionError =
        err?.code === 'P1001' ||
        err?.code === 'P1002' ||
        err?.code === 'P2024' ||
        (err?.message && (
          err.message.includes('Closed') ||
          err.message.includes('Can\'t reach database') ||
          err.message.includes('Connection pool') ||
          err.message.includes('timed out') ||
          err.message.includes('already disconnected')
        ));

      if (isPrismaConnectionError && attempt < maxRetries) {
        console.warn(`[prisma] ${context} attempt ${attempt}/${maxRetries} failed. Retrying...`);
        await new Promise(r => setTimeout(r, 500));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

class ClientRepository {
  /**
   * Generate next client code (CLI-00001, CLI-00002, etc.)
   */
  async generateClientCode(tx = null) {
    const client = tx || prisma;
    const lastClient = await client.client.findFirst({
      where: { deleted_at: null },
      orderBy: { client_code: 'desc' },
      select: { client_code: true },
    });

    let nextNum = 1;
    if (lastClient && lastClient.client_code) {
      const match = lastClient.client_code.match(/CLI-(\d+)/);
      if (match) {
        nextNum = parseInt(match[1]) + 1;
      }
    }
    return `CLI-${String(nextNum).padStart(5, '0')}`;
  }

  /**
   * Find client by ID (excluding soft-deleted)
   */
  async findById(clientId) {
    return await prisma.client.findFirst({
      where: {
        client_id: clientId,
        deleted_at: null,
      },
    });
  }

  /**
   * Find client by ID with full relations
   */
  async findByIdWithRelations(clientId) {
    return await prisma.client.findFirst({
      where: {
        client_id: clientId,
        deleted_at: null,
      },
      include: {
        _count: {
          select: {
            trips: true,
          },
        },
      },
    });
  }

  /**
   * Find client by company name
   */
  async findByCompanyName(companyName) {
    return await prisma.client.findFirst({
      where: {
        company_name: companyName,
        deleted_at: null,
      },
    });
  }

  /**
   * Find client by phone
   */
  async findByPhone(phone) {
    return await prisma.client.findFirst({
      where: {
        phone,
        deleted_at: null,
      },
    });
  }

  /**
   * Find client by client code
   */
  async findByClientCode(clientCode) {
    return await prisma.client.findFirst({
      where: {
        client_code: clientCode,
        deleted_at: null,
      },
    });
  }

  /**
   * List clients with search, filter, sort, pagination
   */
  async findAll(filters = {}) {
    const {
      page = 1,
      limit = 20,
      search = '',
      status = '',
      city = '',
      state = '',
      sort_by = 'created_at',
      sort_order = 'desc',
    } = filters;

    const skip = (page - 1) * limit;
    const take = parseInt(limit);

    const where = { deleted_at: null };

    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { client_code: { contains: searchTerm, mode: 'insensitive' } },
        { company_name: { contains: searchTerm, mode: 'insensitive' } },
        { contact_person: { contains: searchTerm, mode: 'insensitive' } },
        { phone: { contains: searchTerm } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
        { city: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }
    if (city) {
      where.city = { contains: city, mode: 'insensitive' };
    }
    if (state) {
      where.state = { contains: state, mode: 'insensitive' };
    }

    const allowedSortFields = ['client_code', 'company_name', 'status', 'created_at', 'city', 'state'];
    const field = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const order = sort_order === 'asc' ? 'asc' : 'desc';

    const result = await withRetry(async () => {
      const [clients, total] = await Promise.all([
        prisma.client.findMany({
          where,
          include: {
            _count: {
              select: {
                trips: true,
              },
            },
          },
          orderBy: { [field]: order },
          skip,
          take,
        }),
        prisma.client.count({ where }),
      ]);
      return { clients, total };
    }, 'findAll clients');

    return {
      clients: result.clients,
      pagination: {
        page: parseInt(page),
        limit: take,
        total: result.total,
        pages: Math.ceil(result.total / take),
      },
    };
  }

  /**
   * Search clients for trip creation lookup (lightweight)
   */
  async searchForLookup(search = '') {
    const where = { deleted_at: null };

    if (search) {
      const searchTerm = String(search).trim();
      where.OR = [
        { company_name: { contains: searchTerm, mode: 'insensitive' } },
        { client_code: { contains: searchTerm, mode: 'insensitive' } },
        { contact_person: { contains: searchTerm, mode: 'insensitive' } },
        { phone: { contains: searchTerm } },
        { email: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    return await prisma.client.findMany({
      where,
      select: {
        client_id: true,
        client_code: true,
        company_name: true,
        contact_person: true,
        phone: true,
        email: true,
        city: true,
        state: true,
        status: true,
      },
      orderBy: { company_name: 'asc' },
      take: 50,
    });
  }

  /**
   * Create a new client
   */
  async create(data) {
    const clientCode = await this.generateClientCode();

    return await prisma.client.create({
      data: {
        ...data,
        client_code: clientCode,
      },
      select: {
        client_id: true,
        client_code: true,
        company_name: true,
        contact_person: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        state: true,
        gst_number: true,
        pan_number: true,
        bank_account: true,
        bank_ifsc: true,
        bank_name: true,
        upi_id: true,
        status: true,
        notes: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  /**
   * Update an existing client
   */
  async update(clientId, data) {
    return await prisma.client.update({
      where: { client_id: clientId },
      data: {
        ...data,
        updated_at: new Date(),
      },
      select: {
        client_id: true,
        client_code: true,
        company_name: true,
        contact_person: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        state: true,
        gst_number: true,
        pan_number: true,
        bank_account: true,
        bank_ifsc: true,
        bank_name: true,
        upi_id: true,
        status: true,
        notes: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  /**
   * Soft delete a client (set deleted_at)
   */
  async softDelete(clientId) {
    return await prisma.client.update({
      where: { client_id: clientId },
      data: {
        deleted_at: new Date(),
        is_active: false,
        status: 'inactive',
        updated_at: new Date(),
      },
    });
  }

  /**
   * Deactivate a client (set is_active = false, status = inactive)
   */
  async deactivate(clientId) {
    return await prisma.client.update({
      where: { client_id: clientId },
      data: {
        is_active: false,
        status: 'inactive',
        updated_at: new Date(),
      },
      select: {
        client_id: true,
        client_code: true,
        company_name: true,
        contact_person: true,
        phone: true,
        email: true,
        status: true,
        is_active: true,
        updated_at: true,
      },
    });
  }

  /**
   * Reactivate a client
   */
  async reactivate(clientId) {
    return await prisma.client.update({
      where: { client_id: clientId },
      data: {
        is_active: true,
        status: 'active',
        updated_at: new Date(),
      },
      select: {
        client_id: true,
        client_code: true,
        company_name: true,
        contact_person: true,
        phone: true,
        email: true,
        status: true,
        is_active: true,
        updated_at: true,
      },
    });
  }

  /**
   * Count total active clients
   */
  async countActive() {
    return await prisma.client.count({
      where: {
        deleted_at: null,
        is_active: true,
      },
    });
  }
}

module.exports = ClientRepository;
