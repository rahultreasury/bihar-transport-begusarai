/**
 * ClientService
 * Business logic for offline corporate client management.
 * Handles client CRUD and lookup for trip creation.
 */

const ClientRepository = require('../repositories/ClientRepository');
const { AppError, ValidationError } = require('../utils/AppError');

class ClientService {
  constructor() {
    this.repo = new ClientRepository();
  }

  /**
   * List clients with filters
   */
  async listClients(filters = {}) {
    return await this.repo.findAll(filters);
  }

  /**
   * Get client profile by ID
   */
  async getClientProfile(clientId) {
    const client = await this.repo.findByIdWithRelations(clientId);
    if (!client) {
      throw new ValidationError('Client not found');
    }
    return client;
  }

  /**
   * Create a new client
   */
  async createClient(data) {
    const { company_name, phone, email } = data;

    // Check for duplicate company name
    const existingByCompany = await this.repo.findByCompanyName(company_name);
    if (existingByCompany) {
      const err = new Error('A client with this company name already exists');
      err.code = 'CLIENT_ALREADY_EXISTS';
      err.data = {
        client_id: existingByCompany.client_id,
        company_name: existingByCompany.company_name,
        client_code: existingByCompany.client_code,
      };
      throw err;
    }

    // Check for duplicate phone
    const existingByPhone = await this.repo.findByPhone(phone);
    if (existingByPhone) {
      const err = new Error('A client with this phone number already exists');
      err.code = 'CLIENT_ALREADY_EXISTS';
      err.data = {
        client_id: existingByPhone.client_id,
        company_name: existingByPhone.company_name,
        client_code: existingByPhone.client_code,
      };
      throw err;
    }

    // Check for duplicate email (if provided)
    if (email) {
      const existingByEmail = await this.repo.searchForLookup(email);
      const match = existingByEmail.find(c => c.email === email);
      if (match) {
        const err = new Error('A client with this email already exists');
        err.code = 'CLIENT_ALREADY_EXISTS';
        err.data = {
          client_id: match.client_id,
          company_name: match.company_name,
          client_code: match.client_code,
        };
        throw err;
      }
    }

    const clientData = {
      company_name: data.company_name,
      contact_person: data.contact_person || null,
      phone: data.phone,
      email: data.email || null,
      address: data.address || null,
      city: data.city || null,
      state: data.state || 'Bihar',
      gst_number: data.gst_number || null,
      pan_number: data.pan_number || null,
      bank_account: data.bank_account || null,
      bank_ifsc: data.bank_ifsc || null,
      bank_name: data.bank_name || null,
      upi_id: data.upi_id || null,
      status: data.status || 'active',
      notes: data.notes || null,
      is_active: true,
    };

    return await this.repo.create(clientData);
  }

  /**
   * Update an existing client
   */
  async updateClient(clientId, data) {
    // Verify client exists
    const existing = await this.repo.findById(clientId);
    if (!existing) {
      throw new ValidationError('Client not found');
    }

    // Check for duplicate company name (if changing)
    if (data.company_name && data.company_name !== existing.company_name) {
      const duplicate = await this.repo.findByCompanyName(data.company_name);
      if (duplicate && duplicate.client_id !== clientId) {
        const err = new Error('A client with this company name already exists');
        err.code = 'CLIENT_ALREADY_EXISTS';
        throw err;
      }
    }

    // Check for duplicate phone (if changing)
    if (data.phone && data.phone !== existing.phone) {
      const duplicate = await this.repo.findByPhone(data.phone);
      if (duplicate && duplicate.client_id !== clientId) {
        const err = new Error('A client with this phone number already exists');
        err.code = 'CLIENT_ALREADY_EXISTS';
        throw err;
      }
    }

    // Check for duplicate email (if changing)
    if (data.email && data.email !== existing.email) {
      const allClients = await this.repo.searchForLookup(data.email);
      const duplicate = allClients.find(c => c.email === data.email && c.client_id !== clientId);
      if (duplicate) {
        const err = new Error('A client with this email already exists');
        err.code = 'CLIENT_ALREADY_EXISTS';
        throw err;
      }
    }

    const updateData = {};
    const allowedFields = [
      'company_name', 'contact_person', 'phone', 'email', 'address',
      'city', 'state', 'gst_number', 'pan_number', 'bank_account',
      'bank_ifsc', 'bank_name', 'upi_id', 'status', 'notes',
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    return await this.repo.update(clientId, updateData);
  }

  /**
   * Deactivate a client
   */
  async deactivateClient(clientId) {
    const existing = await this.repo.findById(clientId);
    if (!existing) {
      throw new ValidationError('Client not found');
    }

    return await this.repo.deactivate(clientId);
  }

  /**
   * Reactivate a client
   */
  async reactivateClient(clientId) {
    const existing = await this.repo.findById(clientId);
    if (!existing) {
      throw new ValidationError('Client not found');
    }

    return await this.repo.reactivate(clientId);
  }

  /**
   * Search clients for trip creation lookup
   */
  async searchForLookup(search = '') {
    return await this.repo.searchForLookup(search);
  }

  /**
   * Count active clients
   */
  async countActiveClients() {
    return await this.repo.countActive();
  }
}

module.exports = ClientService;
