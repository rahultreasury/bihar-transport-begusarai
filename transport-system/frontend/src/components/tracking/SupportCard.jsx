import React from 'react';

const PHONE_NUMBER = '+918210931799';
const WHATSAPP_NUMBER = '918210931799';

/**
 * SupportCard — Contact support section with call and WhatsApp options.
 * @param {{ bookingRef?: string }} props
 */
const SupportCard = React.memo(function SupportCard({ bookingRef }) {
  const whatsappMessage = bookingRef
    ? `Hello Bihar Transport, I have a query regarding my booking ${bookingRef}. Please help.`
    : 'Hello Bihar Transport, I need help with my booking. Please assist.';

  return (
    <div className="rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 shadow-sm p-5 md:p-6">
      <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
        Need Help?
      </h3>

      <div className="space-y-3">
        {/* Call Support */}
        <a
          href={`tel:${PHONE_NUMBER}`}
          className="flex items-center gap-4 rounded-xl bg-white p-4 border border-gray-100 hover:border-amber-200 hover:shadow-sm transition-all group cursor-pointer"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600 group-hover:bg-green-100 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors">
              Call Bihar Transport
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Speak directly with our support team</p>
          </div>
          <svg className="h-4 w-4 text-gray-400 group-hover:text-amber-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </a>

        {/* WhatsApp Support */}
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappMessage)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 rounded-xl bg-white p-4 border border-gray-100 hover:border-green-200 hover:shadow-sm transition-all group cursor-pointer"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600 group-hover:bg-green-100 transition-colors">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 group-hover:text-green-600 transition-colors">
              WhatsApp Support
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Chat with us on WhatsApp</p>
          </div>
          <svg className="h-4 w-4 text-gray-400 group-hover:text-green-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </a>

        {/* Info text */}
        <p className="text-xs text-gray-400 text-center pt-1">
          Our support team is available 24/7 to assist you.
        </p>
      </div>
    </div>
  );
});

export default SupportCard;

