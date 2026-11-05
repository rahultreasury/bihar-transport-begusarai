import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Truck, Building2, ArrowRight, CheckCircle2, Phone, Shield, TrendingUp, HeadphonesIcon } from 'lucide-react';
import SEO from '../components/seo/SEO';

const heroBenefits = [
  {
    icon: Shield,
    title: 'Verified Loads',
    description: 'Regular & genuine transport opportunities',
  },
  {
    icon: TrendingUp,
    title: 'Better Earnings',
    description: 'Higher margins on every booking',
  },
  {
    icon: HeadphonesIcon,
    title: 'Dedicated Support',
    description: 'Help & guidance at every step',
  },
  {
    icon: Truck,
    title: 'Business Growth',
    description: 'Expand your fleet and grow faster',
  },
];

const benefits = [
  {
    number: '01',
    title: 'More Trip Opportunities',
    description: 'Connect your vehicles with verified transport opportunities across Bihar and beyond.',
  },
  {
    number: '02',
    title: 'Fleet & Driver Management',
    description: 'Manage your fleet, drivers, and schedules through a single professional platform.',
  },
  {
    number: '03',
    title: 'Transparent Tracking',
    description: 'Track every trip in real time with clear visibility and accountability.',
  },
  {
    number: '04',
    title: 'Simple Settlement',
    description: 'Receive timely, transparent settlements with full financial clarity.',
  },
];

const steps = [
  {
    number: '01',
    title: 'Register',
    description: 'Submit your details and vehicle or fleet information online.',
  },
  {
    number: '02',
    title: 'Verify',
    description: 'Our team reviews your documents and completes verification.',
  },
  {
    number: '03',
    title: 'Add Vehicles',
    description: 'List your vehicles with registration and insurance details.',
  },
  {
    number: '04',
    title: 'Connect Drivers',
    description: 'Add licensed drivers with valid documentation.',
  },
  {
    number: '05',
    title: 'Start Receiving Trips',
    description: 'Get matched with transport opportunities and start earning.',
  },
];

// Intersection Observer hook for scroll-triggered animations
function useInView(options = {}) {
  const ref = useRef(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1, ...options }
    );

    const currentRef = ref.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, []);

  return [ref, isInView];
}

export default function Partner() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://bihartransport.in/' },
      { '@type': 'ListItem', position: 2, name: 'Become a Partner', item: 'https://bihartransport.in/partner' },
    ],
  };

  const partnerSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Bihar Transport Partner Program',
    description: 'Join Bihar Transport as a transport partner and grow your business with more transportation opportunities.',
    url: 'https://bihartransport.in/partner',
  };

  const [heroRef, heroInView] = useInView();
  const [benefitStripRef, benefitStripInView] = useInView();
  const [cardsRef, cardsInView] = useInView();
  const [whyRef, whyInView] = useInView();
  const [stepsRef, stepsInView] = useInView();
  const [reqRef, reqInView] = useInView();
  const [ctaRef, ctaInView] = useInView();

  return (
    <>
      <SEO
        title="Become a Bihar Transport Partner"
        description="Join the Bihar Transport network and connect your vehicles with more transportation opportunities. Choose Vehicle Owner or Transport Owner partnership."
        keywords="transport partner, vehicle owner, transport owner, Bihar Transport partner, logistics partner"
        canonical="https://bihartransport.in/partner"
        schema={[breadcrumbSchema, partnerSchema]}
      />

      <div className="min-h-screen bg-white">
        {/* ============================================
            HERO SECTION
            ============================================ */}
        <section ref={heroRef} className="relative bg-white">
          {/* Subtle premium accent line */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#C8922E]/40 to-transparent" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 md:pt-10 lg:pt-10 pb-8 md:pb-10 lg:pb-12">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10 items-center">
              {/* Left: Text Content */}
              <div className={`transition-all duration-700 ${heroInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
                {/* Eyebrow */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#EEF4FA] border border-[#0B1F3A]/10 mb-5">
                  <span className="text-xs font-bold text-[#0B1F3A] uppercase tracking-widest">Partner with Bihar Transport</span>
                </div>

                {/* Headline with emphasized words */}
                <h1 className="text-4xl md:text-5xl lg:text-[56px] xl:text-[62px] font-extrabold text-[#111827] tracking-tight mb-4 leading-[1.05]">
                  Grow Your<br />
                  Transport Business<br />
                  With a{' '}
                  <span className="text-[#E84A16]">Trusted</span>{' '}
                  <span className="text-[#E84A16]">Network</span>
                </h1>

                {/* Supporting text */}
                <p className="text-lg md:text-xl text-[#64748B] mb-6 leading-relaxed max-w-xl">
                  Join hands with Bihar Transport and unlock verified opportunities, expand your reach and grow your business across India.
                </p>

                {/* CTAs */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <Link
                    to="/partner/vehicle-owner"
                    className="group inline-flex items-center justify-center gap-2 bg-[#F59E0B] text-white px-7 py-3.5 rounded-lg font-semibold hover:bg-[#d97706] transition-all duration-300 shadow-lg shadow-[#F59E0B]/20 hover:shadow-xl hover:shadow-[#F59E0B]/30 hover:-translate-y-0.5"
                  >
                    Become a Partner
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                  <Link
                    to="/contact"
                    className="inline-flex items-center justify-center gap-2 bg-white border-2 border-[#E5E7EB] text-[#0B1F3A] px-7 py-3.5 rounded-lg font-semibold hover:border-[#0B1F3A]/20 hover:bg-[#F7F9FC] transition-all duration-300"
                  >
                    Talk to Our Team
                  </Link>
                </div>
              </div>

              {/* Right: Branded Transport Visual */}
              <div className={`relative transition-all duration-700 delay-200 ${heroInView ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-6'}`}>
                <div className="partner-hero-image-frame relative w-full max-w-[560px] aspect-square rounded-[24px] border border-[#E5E7EB]/60 overflow-hidden">
                  <img
                    src="/assets/partner-hero.jpg"
                    alt="Bihar Transport - Stronger Partners, Stronger Deliveries"
                    className="w-full h-full object-cover object-center"
                    loading="eager"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================
            BENEFIT STRIP UNDER HERO
            ============================================ */}
        <section ref={benefitStripRef} className="border-y border-[#E5E7EB] bg-[#F7F9FC]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
            <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-0 transition-all duration-700 ${benefitStripInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              {heroBenefits.map((benefit, index) => {
                const Icon = benefit.icon;
                return (
                  <div key={benefit.title} className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-9 h-9 rounded-full bg-[#0B1F3A]/5 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-[#0B1F3A]" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-[#111827] mb-0.5">{benefit.title}</h4>
                      <p className="text-xs text-[#64748B] leading-relaxed">{benefit.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ============================================
            CHOOSE PARTNERSHIP TYPE
            ============================================ */}
        <section ref={cardsRef} className="py-16 md:py-24 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Section Header */}
            <div className={`text-center mb-10 md:mb-12 transition-all duration-700 ${cardsInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
              <h2 className="text-3xl md:text-4xl lg:text-[42px] font-bold text-[#111827] mb-4 tracking-tight">
                Choose How You Want to Partner
              </h2>
              <p className="text-[#64748B] text-lg max-w-2xl mx-auto leading-relaxed">
                Whether you operate a single vehicle or manage a fleet, choose the partnership that fits your business.
              </p>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 max-w-5xl mx-auto">
              {/* Vehicle Owner Card */}
              <Link
                to="/partner/vehicle-owner"
                className={`group relative bg-white rounded-[20px] border border-[#E5E7EB] shadow-sm hover:shadow-md hover:shadow-[#0B1F3A]/5 hover:-translate-y-1 transition-all duration-300 p-8 md:p-10 flex flex-col ${cardsInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
                style={{ transitionDelay: '100ms' }}
              >
                <div className="flex-shrink-0 w-12 h-12 bg-[#0B1F3A]/5 rounded-xl flex items-center justify-center mb-5 group-hover:bg-[#F59E0B]/10 transition-all duration-300">
                  <Truck className="w-6 h-6 text-[#0B1F3A] group-hover:text-[#F59E0B] transition-colors duration-300" />
                </div>
                <h3 className="text-xl md:text-2xl font-bold text-[#0F2747] mb-1">Vehicle Owner</h3>
                <p className="text-[#64748B] text-sm font-medium mb-3">Have a vehicle? Start earning.</p>
                <p className="text-[#64748B] text-base leading-relaxed mb-6 flex-grow">
                  Connect your vehicle with verified transport opportunities and keep it working.
                </p>
                <div className="inline-flex items-center gap-2 text-[#F59E0B] font-semibold text-sm group-hover:gap-3 transition-all duration-300">
                  Register as Vehicle Owner
                  <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                </div>
              </Link>

              {/* Transport Owner Card */}
              <Link
                to="/partner/transport-owner"
                className={`group relative bg-white rounded-[20px] border border-[#E5E7EB] shadow-sm hover:shadow-md hover:shadow-[#0B1F3A]/5 hover:-translate-y-1 transition-all duration-300 p-8 md:p-10 flex flex-col ${cardsInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
                style={{ transitionDelay: '200ms' }}
              >
                {/* Recommended badge */}
                <div className="absolute top-4 right-4">
                  <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/20 text-[#F59E0B] text-xs font-bold uppercase tracking-wider">
                    Recommended
                  </span>
                </div>
                <div className="flex-shrink-0 w-12 h-12 bg-[#0B1F3A]/5 rounded-xl flex items-center justify-center mb-5 group-hover:bg-[#F59E0B]/10 transition-all duration-300">
                  <Building2 className="w-6 h-6 text-[#0B1F3A] group-hover:text-[#F59E0B] transition-colors duration-300" />
                </div>
                <h3 className="text-xl md:text-2xl font-bold text-[#0F2747] mb-1">Transport Owner</h3>
                <p className="text-[#64748B] text-sm font-medium mb-3">Manage your fleet. Grow your business.</p>
                <p className="text-[#64748B] text-base leading-relaxed mb-4 flex-grow">
                  Manage vehicles, drivers and transport opportunities through Bihar Transport.
                </p>
                {/* Visual relationship hint */}
                <div className="flex items-center gap-2 mb-5 text-xs text-[#64748B]">
                  <span className="font-semibold text-[#0F2747]">Transport Owner</span>
                  <svg className="w-4 h-4 text-[#F59E0B]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  <span className="font-semibold text-[#0F2747]">Vehicles + Drivers</span>
                </div>
                <div className="inline-flex items-center gap-2 text-[#F59E0B] font-semibold text-sm group-hover:gap-3 transition-all duration-300">
                  Register as Transport Owner
                  <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                </div>
              </Link>
            </div>
          </div>
        </section>

        {/* ============================================
            WHY BIHAR TRANSPORT
            ============================================ */}
        <section ref={whyRef} className="py-20 md:py-28 bg-[#0B1F3A] relative">
          {/* Subtle gold accent line at top */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#C8922E]/50 to-transparent" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className={`text-center mb-14 md:mb-20 transition-all duration-700 ${whyInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
              <h2 className="text-3xl md:text-4xl lg:text-[42px] font-bold text-white mb-4 tracking-tight">
                Why Transport Owners Choose Bihar Transport
              </h2>
              <p className="text-[#9CA3AF] text-lg max-w-2xl mx-auto leading-relaxed">
                A professional logistics network built for reliability, transparency, and growth.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto">
              {benefits.map((benefit) => (
                <div
                  key={benefit.number}
                  className={`transition-all duration-700 ${whyInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
                  style={{ transitionDelay: `${parseInt(benefit.number) * 100}ms` }}
                >
                  <div className="text-4xl font-bold text-[#C8922E] mb-4">{benefit.number}</div>
                  <h3 className="text-lg font-bold text-white mb-2">{benefit.title}</h3>
                  <p className="text-[#9CA3AF] text-base leading-relaxed">{benefit.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============================================
            HOW PARTNERSHIP WORKS
            ============================================ */}
        <section ref={stepsRef} className="py-20 md:py-28 bg-[#F8F7F3]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className={`text-center mb-14 md:mb-20 transition-all duration-700 ${stepsInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
              <h2 className="text-3xl md:text-4xl lg:text-[42px] font-bold text-[#111827] mb-4 tracking-tight">
                How Partnership Works
              </h2>
              <p className="text-[#64748B] text-lg max-w-2xl mx-auto leading-relaxed">
                A straightforward process to get your fleet connected and earning.
              </p>
            </div>

            <div className="max-w-5xl mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-0 lg:relative">
                {/* Connecting line (desktop only) */}
                <div className="hidden lg:block absolute top-5 left-[10%] right-[10%] h-px bg-[#0B1F3A]/15" />

                {steps.map((step, index) => (
                  <div key={step.number} className="text-center relative">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white border-2 border-[#0B1F3A]/20 text-[#0B1F3A] font-bold text-sm mb-5 relative z-10">
                      {step.number}
                    </div>
                    <h3 className="text-base font-bold text-[#111827] mb-2">{step.title}</h3>
                    <p className="text-[#64748B] text-sm leading-relaxed max-w-[200px] mx-auto">{step.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============================================
            PROFESSIONAL REQUIREMENTS
            ============================================ */}
        <section ref={reqRef} className="py-20 md:py-28 bg-white relative">
          {/* Subtle gold accent line at top */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#C8922E]/30 to-transparent" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className={`text-center mb-14 md:mb-20 transition-all duration-700 ${reqInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
              <h2 className="text-3xl md:text-4xl lg:text-[42px] font-bold text-[#111827] mb-4 tracking-tight">
                What You Need to Get Started
              </h2>
              <p className="text-[#64748B] text-lg max-w-2xl mx-auto leading-relaxed">
                Prepare the following documents and information for a smooth onboarding process.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 max-w-5xl mx-auto">
              {/* Vehicle Owner Requirements */}
              <div className={`bg-[#F8F7F3] rounded-lg p-8 md:p-10 transition-all duration-700 ${reqInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`} style={{ transitionDelay: '100ms' }}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-[#0B1F3A]/5 rounded-lg flex items-center justify-center">
                    <Truck className="w-5 h-5 text-[#0B1F3A]" />
                  </div>
                  <h3 className="text-xl font-bold text-[#111827]">Vehicle Owner</h3>
                </div>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3 text-[#64748B] text-base">
                    <CheckCircle2 className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    Owner information and contact details
                  </li>
                  <li className="flex items-start gap-3 text-[#64748B] text-base">
                    <CheckCircle2 className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    Vehicle registration details (RC)
                  </li>
                  <li className="flex items-start gap-3 text-[#64748B] text-base">
                    <CheckCircle2 className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    Vehicle documents and fitness certificate
                  </li>
                  <li className="flex items-start gap-3 text-[#64748B] text-base">
                    <CheckCircle2 className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    Insurance and permit details
                  </li>
                  <li className="flex items-start gap-3 text-[#64748B] text-base">
                    <CheckCircle2 className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    Driver information and license details
                  </li>
                </ul>
              </div>

              {/* Transport Owner Requirements */}
              <div className={`bg-[#F8F7F3] rounded-lg p-8 md:p-10 transition-all duration-700 ${reqInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`} style={{ transitionDelay: '200ms' }}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-[#0B1F3A]/5 rounded-lg flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-[#0B1F3A]" />
                  </div>
                  <h3 className="text-xl font-bold text-[#111827]">Transport Owner</h3>
                </div>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3 text-[#64748B] text-base">
                    <CheckCircle2 className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    Owner or business information
                  </li>
                  <li className="flex items-start gap-3 text-[#64748B] text-base">
                    <CheckCircle2 className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    Fleet details and vehicle list
                  </li>
                  <li className="flex items-start gap-3 text-[#64748B] text-base">
                    <CheckCircle2 className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    Vehicle documents for each vehicle
                  </li>
                  <li className="flex items-start gap-3 text-[#64748B] text-base">
                    <CheckCircle2 className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    Driver information and valid licenses
                  </li>
                  <li className="flex items-start gap-3 text-[#64748B] text-base">
                    <CheckCircle2 className="w-5 h-5 text-[#F59E0B] mt-0.5 flex-shrink-0" />
                    Required verification documents
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================
            FINAL CTA
            ============================================ */}
        <section ref={ctaRef} className="py-20 md:py-28 bg-[#0B1F3A]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className={`max-w-3xl mx-auto transition-all duration-700 ${ctaInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
              <h2 className="text-3xl md:text-4xl lg:text-[42px] font-bold text-white mb-4 tracking-tight">
                Ready to Put Your Fleet to Work?
              </h2>
              <p className="text-[#9CA3AF] text-lg mb-10 leading-relaxed">
                Join Bihar Transport and connect your vehicles with new transport opportunities.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  to="/partner/vehicle-owner"
                  className="group inline-flex items-center justify-center gap-2 bg-[#F59E0B] text-white px-8 py-4 rounded-lg font-semibold hover:bg-[#d97706] transition-all duration-300 shadow-lg shadow-[#F59E0B]/20 hover:shadow-xl hover:shadow-[#F59E0B]/30 hover:-translate-y-0.5"
                >
                  Become a Partner
                  <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
                <Link
                  to="/contact"
                  className="inline-flex items-center justify-center gap-2 border-2 border-white/20 text-white px-8 py-4 rounded-lg font-semibold hover:bg-white/5 hover:border-white/30 transition-all duration-300"
                >
                  <Phone className="w-4 h-4" />
                  Contact Our Team
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
