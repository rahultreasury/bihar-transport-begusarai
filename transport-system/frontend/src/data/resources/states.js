/**
 * States Data — All 28 Indian States with SEO metadata
 * Used to dynamically generate /transport-services/:state pages
 */
const states = [
  {
    name: 'Bihar',
    slug: 'bihar',
    capital: 'Patna',
    majorCities: ['Patna', 'Begusarai', 'Muzaffarpur', 'Gaya', 'Darbhanga', 'Bhagalpur', 'Purnia', 'Arrah', 'Bihar Sharif', 'Katihar'],
    serviceDescription: 'Professional goods transportation and logistics services across Bihar. We offer reliable truck, mini truck, pickup, and tempo services for all your cargo needs in Bihar.',
    metaDescription: 'Book trucks & goods transport across Bihar with Bihar Transport. Reliable logistics in Patna, Begusarai, Muzaffarpur & more. FTL, PTL services since 1998.',
    keywords: 'goods transport Bihar, truck booking Patna, logistics Bihar, cargo services Bihar, Bihar transport services',
    highlights: [' Largest road network in Eastern India', ' 24/7 service across all districts', ' Real-time GPS tracking', ' Competitive FTL and PTL rates'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Dedicated trucks for bulk cargo across Bihar' },
      { name: 'Part Truck Load (PTL)', description: 'Cost-effective shared truck transport' },
      { name: 'Industrial Logistics', description: 'Specialized transport for industrial goods' },
      { name: 'Commercial Transport', description: 'Business-to-business goods movement' }
    ],
    faq: [
      { q: 'What transport services are available in Bihar?', a: 'We offer FTL, PTL, industrial logistics, commercial transport, and Pan India services across all major Bihar cities.' },
      { q: 'How can I book a truck in Bihar?', a: 'You can book online through our website or call us at +91 8210931799 for immediate assistance.' },
      { q: 'Which cities in Bihar do you serve?', a: 'We serve all major Bihar cities including Patna, Begusarai, Muzaffarpur, Gaya, Darbhanga, Bhagalpur, Purnia, and more.' },
      { q: 'What is the cost of goods transport in Bihar?', a: 'Our pricing starts at ₹12/km for pickups and varies by vehicle type. Use our online calculator for an instant quote.' }
    ]
  },
  {
    name: 'Uttar Pradesh',
    slug: 'uttar-pradesh',
    capital: 'Lucknow',
    majorCities: ['Lucknow', 'Kanpur', 'Varanasi', 'Agra', 'Prayagraj', 'Ghaziabad', 'Noida', 'Meerut', 'Bareilly', 'Moradabad'],
    serviceDescription: 'Comprehensive goods transportation and logistics services across Uttar Pradesh. Reliable trucking solutions connecting all major UP cities.',
    metaDescription: 'Book trucks & logistics in Uttar Pradesh with Bihar Transport. FTL, PTL, goods transport in Lucknow, Kanpur, Varanasi, Agra & more.',
    keywords: 'goods transport Uttar Pradesh, truck booking Lucknow, logistics UP, cargo services Kanpur',
    highlights: [' Coverage across all 75 districts', ' Interstate connectivity', ' Warehousing solutions', ' Express delivery options'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Dedicated trucks for bulk cargo across UP' },
      { name: 'Part Truck Load (PTL)', description: 'Shared truckload for smaller consignments' },
      { name: 'Industrial Logistics', description: 'End-to-end supply chain solutions' },
      { name: 'Pan India Transport', description: 'Nationwide connectivity from UP' }
    ],
    faq: [
      { q: 'What transport services are available in Uttar Pradesh?', a: 'We provide FTL, PTL, industrial logistics, and commercial transport across all major UP cities.' },
      { q: 'How can I book goods transport in UP?', a: 'Book online via our website or call +91 8210931799 for quick service.' }
    ]
  },
  {
    name: 'Delhi',
    slug: 'delhi',
    capital: 'New Delhi',
    majorCities: ['New Delhi', 'Dwarka', 'Rohini', 'Saket', 'Karol Bagh', 'Connaught Place', 'Lajpat Nagar', 'Pitampura', 'Vasant Kunj', 'Hauz Khas'],
    serviceDescription: 'Professional logistics and goods transportation services in Delhi NCR. Reliable trucking for businesses across the national capital.',
    metaDescription: 'Book trucks & goods transport in Delhi NCR. Reliable logistics services across Delhi. FTL, PTL, courier cargo. Same-day delivery options available.',
    keywords: 'goods transport Delhi, truck booking Delhi NCR, logistics Delhi, cargo services Delhi',
    highlights: [' Delhi NCR coverage', ' Same-day delivery', ' GPS tracked vehicles', ' Secure warehousing'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Delhi NCR' },
      { name: 'Part Truck Load (PTL)', description: 'Cost-effective shared transport' },
      { name: 'Industrial Logistics', description: 'Supply chain for Delhi businesses' },
      { name: 'Commercial Transport', description: 'Business goods delivery in Delhi' }
    ],
    faq: [
      { q: 'What transport services are available in Delhi?', a: 'We offer FTL, PTL, and commercial logistics across Delhi NCR with real-time tracking.' },
      { q: 'How can I book a truck in Delhi?', a: 'Book online or call +91 8210931799 for instant truck booking in Delhi.' }
    ]
  },
  {
    name: 'Punjab',
    slug: 'punjab',
    capital: 'Chandigarh',
    majorCities: ['Chandigarh', 'Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Patiala', 'Hoshiarpur', 'Batala'],
    serviceDescription: 'Reliable goods transportation and logistics services across Punjab. Connecting all major industrial and commercial hubs.',
    metaDescription: 'Book trucks & goods transport in Punjab. Logistics services in Chandigarh, Ludhiana, Amritsar & more. FTL, PTL, industrial transport.',
    keywords: 'goods transport Punjab, truck booking Chandigarh, logistics Ludhiana, cargo Amritsar',
    highlights: [' Industrial corridor coverage', ' Interstate connectivity', ' Cold chain logistics', ' Express freight services'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Dedicated transport for bulk goods in Punjab' },
      { name: 'Part Truck Load (PTL)', description: 'Shared trucking for smaller loads' },
      { name: 'Industrial Logistics', description: 'Supply chain for Punjab industries' }
    ],
    faq: [
      { q: 'What transport services does Bihar Transport offer in Punjab?', a: 'FTL, PTL, industrial logistics, and commercial transport across all major Punjab cities.' },
      { q: 'How to book goods transport in Punjab?', a: 'Book online or contact +91 8210931799 for immediate service.' }
    ]
  },
  {
    name: 'Haryana',
    slug: 'haryana',
    capital: 'Chandigarh',
    majorCities: ['Chandigarh', 'Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Karnal', 'Sonipat', 'Rohtak', 'Hisar', 'Yamunanagar'],
    serviceDescription: 'Professional logistics and goods transport services across Haryana. Serving industrial corridors and commercial hubs.',
    metaDescription: 'Book trucks & goods transport in Haryana. Logistics in Gurugram, Faridabad, Panipat & more. FTL, PTL, industrial transport.',
    keywords: 'goods transport Haryana, truck booking Gurugram, logistics Faridabad, cargo Panipat',
    highlights: [' NCR connectivity', ' Industrial area coverage', ' Dedicated fleet', ' Real-time tracking'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Haryana' },
      { name: 'Part Truck Load (PTL)', description: 'Shared truckload services' },
      { name: 'Industrial Logistics', description: 'Specialized industrial transport' }
    ],
    faq: [
      { q: 'What transport services are available in Haryana?', a: 'We offer FTL, PTL, and industrial logistics across Haryana with real-time GPS tracking.' }
    ]
  },
  {
    name: 'Rajasthan',
    slug: 'rajasthan',
    capital: 'Jaipur',
    majorCities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Bikaner', 'Ajmer', 'Bhilwara', 'Alwar', 'Sikar', 'Pali'],
    serviceDescription: 'Comprehensive goods transportation services across Rajasthan. Connecting desert cities and industrial hubs.',
    metaDescription: 'Book trucks & logistics in Rajasthan. Goods transport in Jaipur, Jodhpur, Udaipur & more. FTL, PTL services available.',
    keywords: 'goods transport Rajasthan, truck booking Jaipur, logistics Jodhpur, cargo Udaipur',
    highlights: [' State-wide coverage', ' Desert logistics expertise', ' Industrial transport', ' 24/7 support'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Dedicated trucks for Rajasthan routes' },
      { name: 'Part Truck Load (PTL)', description: 'Cost-effective shared transport' },
      { name: 'Industrial Logistics', description: 'Supply chain for Rajasthan industries' }
    ],
    faq: [
      { q: 'What transport services does Bihar Transport offer in Rajasthan?', a: 'FTL, PTL, and industrial logistics across all major Rajasthan cities.' }
    ]
  },
  {
    name: 'Jharkhand',
    slug: 'jharkhand',
    capital: 'Ranchi',
    majorCities: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Deoghar', 'Hazaribagh', 'Giridih', 'Ramgarh', 'Dumka', 'Phusro'],
    serviceDescription: 'Reliable goods transportation and logistics services across Jharkhand. Serving mining and industrial sectors.',
    metaDescription: 'Book trucks & goods transport in Jharkhand. Logistics in Ranchi, Jamshedpur, Dhanbad & more. Industrial transport specialists.',
    keywords: 'goods transport Jharkhand, truck booking Ranchi, logistics Jamshedpur, cargo Dhanbad',
    highlights: [' Mining sector logistics', ' Industrial transport', ' GPS tracked fleet', ' 24/7 availability'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport for mining and industry' },
      { name: 'Part Truck Load (PTL)', description: 'Shared transport solutions' },
      { name: 'Industrial Logistics', description: 'Specialized industrial goods transport' }
    ],
    faq: [
      { q: 'What transport services are available in Jharkhand?', a: 'FTL, PTL, industrial logistics, and mining sector transport across Jharkhand.' }
    ]
  },
  {
    name: 'West Bengal',
    slug: 'west-bengal',
    capital: 'Kolkata',
    majorCities: ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Bardhaman', 'Malda', 'Kharagpur', 'Haldia', 'Krishnanagar'],
    serviceDescription: 'Professional goods transportation and logistics across West Bengal. Connecting the eastern gateway of India.',
    metaDescription: 'Book trucks & goods transport in West Bengal. Logistics in Kolkata, Howrah, Siliguri & more. FTL, PTL, industrial transport.',
    keywords: 'goods transport West Bengal, truck booking Kolkata, logistics Howrah, cargo Siliguri',
    highlights: [' Eastern India hub', ' Port connectivity', ' Industrial logistics', ' Pan India network'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Dedicated transport for West Bengal routes' },
      { name: 'Part Truck Load (PTL)', description: 'Shared trucking services' },
      { name: 'Industrial Logistics', description: 'Supply chain for industries' },
      { name: 'Port Logistics', description: 'Haldia and Kolkata port connectivity' }
    ],
    faq: [
      { q: 'What transport services does Bihar Transport offer in West Bengal?', a: 'FTL, PTL, industrial logistics, and port logistics across West Bengal.' }
    ]
  },
  {
    name: 'Maharashtra',
    slug: 'maharashtra',
    capital: 'Mumbai',
    majorCities: ['Mumbai', 'Pune', 'Nagpur', 'Thane', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Amravati', 'Malegaon'],
    serviceDescription: 'Comprehensive logistics and goods transportation across Maharashtra. From Mumbai ports to industrial Pune.',
    metaDescription: 'Book trucks & goods transport in Maharashtra. Logistics in Mumbai, Pune, Nagpur & more. FTL, PTL, industrial transport.',
    keywords: 'goods transport Maharashtra, truck booking Mumbai, logistics Pune, cargo Nagpur',
    highlights: [' Mumbai port logistics', ' Industrial corridor coverage', ' Nationwide connectivity', ' Dedicated fleet'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Maharashtra' },
      { name: 'Part Truck Load (PTL)', description: 'Shared load solutions' },
      { name: 'Industrial Logistics', description: 'Supply chain for Maharashtra industries' },
      { name: 'Port Logistics', description: 'Mumbai and JNPT port connectivity' }
    ],
    faq: [
      { q: 'What transport services are available in Maharashtra?', a: 'FTL, PTL, industrial logistics, and port logistics across all major cities.' }
    ]
  },
  {
    name: 'Gujarat',
    slug: 'gujarat',
    capital: 'Gandhinagar',
    majorCities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Junagadh', 'Gandhinagar', 'Anand', 'Navsari'],
    serviceDescription: 'Reliable goods transportation and logistics services across Gujarat. Serving industrial corridors and port cities.',
    metaDescription: 'Book trucks & goods transport in Gujarat. Logistics in Ahmedabad, Surat, Vadodara & more. Industrial transport specialists.',
    keywords: 'goods transport Gujarat, truck booking Ahmedabad, logistics Surat, cargo Vadodara',
    highlights: [' Port connectivity', ' Industrial corridor', ' Chemical logistics', ' GPS tracking'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Gujarat' },
      { name: 'Part Truck Load (PTL)', description: 'Shared truckload services' },
      { name: 'Industrial Logistics', description: 'Chemical and industrial transport' }
    ],
    faq: [
      { q: 'What transport services are available in Gujarat?', a: 'FTL, PTL, industrial logistics with port connectivity across Gujarat.' }
    ]
  },
  {
    name: 'Madhya Pradesh',
    slug: 'madhya-pradesh',
    capital: 'Bhopal',
    majorCities: ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Dewas', 'Satna', 'Ratlam', 'Rewa'],
    serviceDescription: 'Professional goods transport and logistics across Madhya Pradesh. Central India\'s reliable logistics partner.',
    metaDescription: 'Book trucks & goods transport in Madhya Pradesh. Logistics in Bhopal, Indore, Jabalpur & more. FTL, PTL services.',
    keywords: 'goods transport Madhya Pradesh, truck booking Indore, logistics Bhopal, cargo Jabalpur',
    highlights: [' Central India hub', ' Industrial coverage', ' Interstate routes', ' 24/7 service'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Dedicated transport for MP routes' },
      { name: 'Part Truck Load (PTL)', description: 'Cost-effective shared transport' },
      { name: 'Industrial Logistics', description: 'Industrial goods transport' }
    ],
    faq: [
      { q: 'What transport services are available in Madhya Pradesh?', a: 'FTL, PTL, and industrial logistics across all major MP cities.' }
    ]
  },
  {
    name: 'Tamil Nadu',
    slug: 'tamil-nadu',
    capital: 'Chennai',
    majorCities: ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Tiruppur', 'Erode', 'Vellore', 'Thoothukudi'],
    serviceDescription: 'Comprehensive logistics and goods transportation across Tamil Nadu. Serving industrial and commercial hubs.',
    metaDescription: 'Book trucks & goods transport in Tamil Nadu. Logistics in Chennai, Coimbatore, Madurai & more. FTL, PTL services.',
    keywords: 'goods transport Tamil Nadu, truck booking Chennai, logistics Coimbatore, cargo Madurai',
    highlights: [' Port connectivity', ' Industrial hubs', ' GPS tracking', ' Express delivery'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Tamil Nadu' },
      { name: 'Part Truck Load (PTL)', description: 'Shared truckload services' },
      { name: 'Industrial Logistics', description: 'Industrial supply chain solutions' }
    ],
    faq: [
      { q: 'What transport services are available in Tamil Nadu?', a: 'FTL, PTL, and industrial logistics across all major Tamil Nadu cities.' }
    ]
  },
  {
    name: 'Karnataka',
    slug: 'karnataka',
    capital: 'Bengaluru',
    majorCities: ['Bengaluru', 'Mysuru', 'Hubli', 'Mangaluru', 'Belagavi', 'Davangere', 'Bellary', 'Shivamogga', 'Tumkur', 'Udupi'],
    serviceDescription: 'Reliable goods transportation and logistics across Karnataka. From Bengaluru tech hubs to coastal Mangaluru.',
    metaDescription: 'Book trucks & goods transport in Karnataka. Logistics in Bengaluru, Mysuru, Mangaluru & more. FTL, PTL services.',
    keywords: 'goods transport Karnataka, truck booking Bengaluru, logistics Mysuru, cargo Mangaluru',
    highlights: [' Tech hub logistics', ' Port connectivity', ' Industrial corridors', ' Real-time tracking'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Dedicated transport for Karnataka' },
      { name: 'Part Truck Load (PTL)', description: 'Shared load solutions' },
      { name: 'Industrial Logistics', description: 'Supply chain for industries' }
    ],
    faq: [
      { q: 'What transport services are available in Karnataka?', a: 'FTL, PTL, and industrial logistics across all major Karnataka cities.' }
    ]
  },
  {
    name: 'Andhra Pradesh',
    slug: 'andhra-pradesh',
    capital: 'Amaravati',
    majorCities: ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Rajahmundry', 'Tirupati', 'Kakinada', 'Anantapur', 'Eluru'],
    serviceDescription: 'Professional goods transport and logistics across Andhra Pradesh. Serving coastal and industrial regions.',
    metaDescription: 'Book trucks & goods transport in Andhra Pradesh. Logistics in Visakhapatnam, Vijayawada & more. FTL, PTL services.',
    keywords: 'goods transport Andhra Pradesh, truck booking Visakhapatnam, logistics Vijayawada',
    highlights: [' Port city logistics', ' Industrial corridors', ' GPS fleet', ' 24/7 support'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across AP' },
      { name: 'Part Truck Load (PTL)', description: 'Shared trucking services' },
      { name: 'Industrial Logistics', description: 'Industrial goods transport' }
    ],
    faq: [
      { q: 'What transport services are available in Andhra Pradesh?', a: 'FTL, PTL, and industrial logistics across all major AP cities.' }
    ]
  },
  {
    name: 'Telangana',
    slug: 'telangana',
    capital: 'Hyderabad',
    majorCities: ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Ramagundam', 'Mahbubnagar', 'Nalgonda', 'Adilabad', 'Suryapet'],
    serviceDescription: 'Comprehensive logistics and goods transportation across Telangana. Connecting Hyderabad with all regions.',
    metaDescription: 'Book trucks & goods transport in Telangana. Logistics in Hyderabad, Warangal & more. FTL, PTL, industrial transport.',
    keywords: 'goods transport Telangana, truck booking Hyderabad, logistics Warangal',
    highlights: [' Hyderabad hub', ' Industrial corridors', ' GPS tracking', ' Express delivery'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Dedicated transport for Telangana' },
      { name: 'Part Truck Load (PTL)', description: 'Shared load solutions' },
      { name: 'Industrial Logistics', description: 'Industrial supply chain' }
    ],
    faq: [
      { q: 'What transport services are available in Telangana?', a: 'FTL, PTL, and industrial logistics across all major Telangana cities.' }
    ]
  },
  {
    name: 'Kerala',
    slug: 'kerala',
    capital: 'Thiruvananthapuram',
    majorCities: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Alappuzha', 'Kannur', 'Kottayam', 'Palakkad', 'Malappuram'],
    serviceDescription: 'Reliable goods transportation and logistics across Kerala. Serving God\'s Own Country with professional transport.',
    metaDescription: 'Book trucks & goods transport in Kerala. Logistics in Kochi, Thiruvananthapuram, Kozhikode & more. FTL, PTL services.',
    keywords: 'goods transport Kerala, truck booking Kochi, logistics Thiruvananthapuram',
    highlights: [' Port connectivity', ' Tourism logistics', ' Industrial transport', ' GPS tracked'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Kerala' },
      { name: 'Part Truck Load (PTL)', description: 'Shared trucking services' },
      { name: 'Industrial Logistics', description: 'Industrial goods transport' }
    ],
    faq: [
      { q: 'What transport services are available in Kerala?', a: 'FTL, PTL, and industrial logistics across all major Kerala cities.' }
    ]
  },
  {
    name: 'Odisha',
    slug: 'odisha',
    capital: 'Bhubaneswar',
    majorCities: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri', 'Balasore', 'Bhadrak', 'Jharsuguda', 'Paradip'],
    serviceDescription: 'Professional goods transport and logistics services across Odisha. Serving industrial and coastal regions.',
    metaDescription: 'Book trucks & goods transport in Odisha. Logistics in Bhubaneswar, Cuttack, Rourkela & more. FTL, PTL services.',
    keywords: 'goods transport Odisha, truck booking Bhubaneswar, logistics Cuttack',
    highlights: [' Industrial corridors', ' Port connectivity', ' Mining logistics', ' 24/7 service'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Odisha' },
      { name: 'Part Truck Load (PTL)', description: 'Shared load solutions' },
      { name: 'Industrial Logistics', description: 'Mining and industrial transport' }
    ],
    faq: [
      { q: 'What transport services are available in Odisha?', a: 'FTL, PTL, industrial logistics, and mining transport across Odisha.' }
    ]
  },
  {
    name: 'Assam',
    slug: 'assam',
    capital: 'Dispur',
    majorCities: ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tinsukia', 'Bongaigaon', 'Tezpur', 'Goalpara', 'Barpeta'],
    serviceDescription: 'Reliable goods transportation and logistics across Assam. Gateway to Northeast India.',
    metaDescription: 'Book trucks & goods transport in Assam. Logistics in Guwahati, Silchar, Dibrugarh & more. FTL, PTL, Northeast transport.',
    keywords: 'goods transport Assam, truck booking Guwahati, logistics Northeast, cargo Silchar',
    highlights: [' Northeast gateway', ' Tea garden logistics', ' Interstate routes', ' GPS tracking'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Assam' },
      { name: 'Part Truck Load (PTL)', description: 'Shared trucking services' },
      { name: 'Industrial Logistics', description: 'Industrial and tea garden transport' }
    ],
    faq: [
      { q: 'What transport services are available in Assam?', a: 'FTL, PTL, and industrial logistics across Assam and Northeast India.' }
    ]
  },
  {
    name: 'Chhattisgarh',
    slug: 'chhattisgarh',
    capital: 'Raipur',
    majorCities: ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Rajnandgaon', 'Raigarh', 'Jagdalpur', 'Ambikapur', 'Dhamtari'],
    serviceDescription: 'Professional goods transport and logistics across Chhattisgarh. Serving industrial and mining sectors.',
    metaDescription: 'Book trucks & goods transport in Chhattisgarh. Logistics in Raipur, Bhilai, Bilaspur & more. Industrial transport specialists.',
    keywords: 'goods transport Chhattisgarh, truck booking Raipur, logistics Bhilai',
    highlights: [' Industrial corridor', ' Mining logistics', ' Steel plant connectivity', ' GPS fleet'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Chhattisgarh' },
      { name: 'Part Truck Load (PTL)', description: 'Shared load solutions' },
      { name: 'Industrial Logistics', description: 'Mining and industrial transport' }
    ],
    faq: [
      { q: 'What transport services are available in Chhattisgarh?', a: 'FTL, PTL, and industrial logistics across all major Chhattisgarh cities.' }
    ]
  },
  {
    name: 'Himachal Pradesh',
    slug: 'himachal-pradesh',
    capital: 'Shimla',
    majorCities: ['Shimla', 'Dharamshala', 'Mandi', 'Solan', 'Kullu', 'Manali', 'Hamirpur', 'Bilaspur', 'Palampur', 'Chamba'],
    serviceDescription: 'Reliable goods transportation and logistics across Himachal Pradesh. Serving hill stations and industrial areas.',
    metaDescription: 'Book trucks & goods transport in Himachal Pradesh. Logistics in Shimla, Dharamshala, Manali & more. Hill area transport specialists.',
    keywords: 'goods transport Himachal, truck booking Shimla, logistics Dharamshala',
    highlights: [' Hill area logistics', ' Tourism supply chain', ' GPS tracked', ' 24/7 service'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Himachal' },
      { name: 'Part Truck Load (PTL)', description: 'Shared trucking services' }
    ],
    faq: [
      { q: 'What transport services are available in Himachal Pradesh?', a: 'FTL and PTL services across all major Himachal cities with hill area expertise.' }
    ]
  },
  {
    name: 'Uttarakhand',
    slug: 'uttarakhand',
    capital: 'Dehradun',
    majorCities: ['Dehradun', 'Haridwar', 'Rishikesh', 'Haldwani', 'Roorkee', 'Rudrapur', 'Kashipur', 'Nainital', 'Mussoorie', 'Almora'],
    serviceDescription: 'Professional goods transport and logistics across Uttarakhand. Connecting pilgrimage cities and industrial corridors.',
    metaDescription: 'Book trucks & goods transport in Uttarakhand. Logistics in Dehradun, Haridwar, Rishikesh & more. Hill logistics experts.',
    keywords: 'goods transport Uttarakhand, truck booking Dehradun, logistics Haridwar',
    highlights: [' Pilgrimage logistics', ' Industrial corridor', ' GPS tracking', ' Hill area expertise'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Uttarakhand' },
      { name: 'Part Truck Load (PTL)', description: 'Shared load solutions' }
    ],
    faq: [
      { q: 'What transport services are available in Uttarakhand?', a: 'FTL and PTL services across all major Uttarakhand cities and pilgrimage routes.' }
    ]
  },
  {
    name: 'Goa',
    slug: 'goa',
    capital: 'Panaji',
    majorCities: ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda', 'Bicholim', 'Curchorem', 'Valpoi', 'Canacona', 'Quepem'],
    serviceDescription: 'Goods transportation and logistics services across Goa. Serving tourism and port logistics.',
    metaDescription: 'Book trucks & goods transport in Goa. Logistics in Panaji, Margao, Vasco & more. Port and tourism logistics.',
    keywords: 'goods transport Goa, truck booking Panaji, logistics Margao',
    highlights: [' Port logistics', ' Tourism supply chain', ' Interstate routes', ' GPS tracked'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Goa' },
      { name: 'Part Truck Load (PTL)', description: 'Shared trucking services' }
    ],
    faq: [
      { q: 'What transport services are available in Goa?', a: 'FTL, PTL, and port logistics services across Goa.' }
    ]
  },
  {
    name: 'Arunachal Pradesh',
    slug: 'arunachal-pradesh',
    capital: 'Itanagar',
    majorCities: ['Itanagar', 'Naharlagun', 'Pasighat', 'Tawang', 'Bomdila', 'Ziro', 'Aalo', 'Roing', 'Tezu', 'Namsai'],
    serviceDescription: 'Goods transportation services across Arunachal Pradesh. Connecting Northeast India\'s easternmost state.',
    metaDescription: 'Book trucks & goods transport in Arunachal Pradesh. Logistics in Itanagar, Tawang, Pasighat & more.',
    keywords: 'goods transport Arunachal, truck booking Itanagar, logistics Tawang',
    highlights: [' Northeast connectivity', ' Hill logistics', ' GPS tracking'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Arunachal' },
      { name: 'Part Truck Load (PTL)', description: 'Shared load solutions' }
    ],
    faq: [
      { q: 'What transport services are available in Arunachal Pradesh?', a: 'FTL and PTL services across Arunachal Pradesh with Northeast India connectivity.' }
    ]
  },
  {
    name: 'Manipur',
    slug: 'manipur',
    capital: 'Imphal',
    majorCities: ['Imphal', 'Bishnupur', 'Thoubal', 'Churachandpur', 'Ukhrul', 'Senapati', 'Tamenglong', 'Chandel', 'Jiribam', 'Kakching'],
    serviceDescription: 'Professional goods transport across Manipur. Connecting the jewel of India with reliable logistics.',
    metaDescription: 'Book trucks & goods transport in Manipur. Logistics in Imphal & more. Northeast India transport.',
    keywords: 'goods transport Manipur, truck booking Imphal, logistics Northeast',
    highlights: [' Northeast logistics', ' GPS tracked', ' Interstate routes'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Manipur' },
      { name: 'Part Truck Load (PTL)', description: 'Shared trucking services' }
    ],
    faq: [
      { q: 'What transport services are available in Manipur?', a: 'FTL and PTL services across Manipur with Northeast India connectivity.' }
    ]
  },
  {
    name: 'Meghalaya',
    slug: 'meghalaya',
    capital: 'Shillong',
    majorCities: ['Shillong', 'Tura', 'Nongstoin', 'Jowai', 'Baghmara', 'Williamnagar', 'Resubelpara', 'Mawlai', 'Nongpoh', 'Cherrapunji'],
    serviceDescription: 'Reliable goods transportation across Meghalaya. Serving the abode of clouds with professional logistics.',
    metaDescription: 'Book trucks & goods transport in Meghalaya. Logistics in Shillong, Tura & more. Northeast transport.',
    keywords: 'goods transport Meghalaya, truck booking Shillong, logistics Tura',
    highlights: [' Hill logistics', ' Tourism supply chain', ' GPS tracking'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Meghalaya' },
      { name: 'Part Truck Load (PTL)', description: 'Shared load solutions' }
    ],
    faq: [
      { q: 'What transport services are available in Meghalaya?', a: 'FTL and PTL services across Meghalaya with hill area logistics expertise.' }
    ]
  },
  {
    name: 'Mizoram',
    slug: 'mizoram',
    capital: 'Aizawl',
    majorCities: ['Aizawl', 'Lunglei', 'Champhai', 'Serchhip', 'Kolasib', 'Lawngtlai', 'Mamit', 'Saiha', 'Hnahthial', 'Khawzawl'],
    serviceDescription: 'Professional goods transport services across Mizoram. Logistics solutions for Northeast India.',
    metaDescription: 'Book trucks & goods transport in Mizoram. Logistics in Aizawl & more. Northeast India services.',
    keywords: 'goods transport Mizoram, truck booking Aizawl, logistics Northeast',
    highlights: [' Northeast logistics', ' GPS tracked', ' Reliable service'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Mizoram' },
      { name: 'Part Truck Load (PTL)', description: 'Shared trucking services' }
    ],
    faq: [
      { q: 'What transport services are available in Mizoram?', a: 'FTL and PTL services across Mizoram with Northeast India connectivity.' }
    ]
  },
  {
    name: 'Nagaland',
    slug: 'nagaland',
    capital: 'Kohima',
    majorCities: ['Kohima', 'Dimapur', 'Mokokchung', 'Tuensang', 'Wokha', 'Zunheboto', 'Phek', 'Mon', 'Longleng', 'Kiphire'],
    serviceDescription: 'Goods transportation and logistics across Nagaland. Connecting Northeast India reliably.',
    metaDescription: 'Book trucks & goods transport in Nagaland. Logistics in Kohima, Dimapur & more. Northeast transport.',
    keywords: 'goods transport Nagaland, truck booking Kohima, logistics Dimapur',
    highlights: [' Northeast logistics', ' GPS tracking', ' Reliable service'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Nagaland' },
      { name: 'Part Truck Load (PTL)', description: 'Shared load solutions' }
    ],
    faq: [
      { q: 'What transport services are available in Nagaland?', a: 'FTL and PTL services across Nagaland with Northeast India connectivity.' }
    ]
  },
  {
    name: 'Sikkim',
    slug: 'sikkim',
    capital: 'Gangtok',
    majorCities: ['Gangtok', 'Namchi', 'Mangan', 'Gyalshing', 'Pakyong', 'Rhenock', 'Singtam', 'Rangpo', 'Jorethang', 'Daramdin'],
    serviceDescription: 'Professional goods transport services across Sikkim. Logistics for Northeast India\'s scenic state.',
    metaDescription: 'Book trucks & goods transport in Sikkim. Logistics in Gangtok & more. Northeast transport services.',
    keywords: 'goods transport Sikkim, truck booking Gangtok, logistics Northeast',
    highlights: [' Hill logistics', ' Tourism supply chain', ' GPS tracked'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Sikkim' },
      { name: 'Part Truck Load (PTL)', description: 'Shared trucking services' }
    ],
    faq: [
      { q: 'What transport services are available in Sikkim?', a: 'FTL and PTL services across Sikkim with hill area logistics expertise.' }
    ]
  },
  {
    name: 'Tripura',
    slug: 'tripura',
    capital: 'Agartala',
    majorCities: ['Agartala', 'Udaipur', 'Dharmanagar', 'Kailashahar', 'Belonia', 'Khowai', 'Ambassa', 'Teliamura', 'Sonamura', 'Sabroom'],
    serviceDescription: 'Reliable goods transport and logistics across Tripura. Northeast India logistics specialists.',
    metaDescription: 'Book trucks & goods transport in Tripura. Logistics in Agartala & more. Northeast transport.',
    keywords: 'goods transport Tripura, truck booking Agartala, logistics Northeast',
    highlights: [' Northeast logistics', ' GPS tracking', ' International border connectivity'],
    services: [
      { name: 'Full Truck Load (FTL)', description: 'Bulk transport across Tripura' },
      { name: 'Part Truck Load (PTL)', description: 'Shared load solutions' }
    ],
    faq: [
      { q: 'What transport services are available in Tripura?', a: 'FTL and PTL services across Tripura with Northeast India connectivity.' }
    ]
  }
];

export default states;
