/**
 * Shared block type definitions for pages + templates.
 * Single source of truth — imported by routes/admin/pages.js & routes/admin/templates.js
 */

export const VALID_BLOCK_TYPES = [
  'hero', 'text', 'split', 'cta', 'cards', 'faq',
  'pricing', 'testimonials', 'stats',
];

/**
 * Field schemas per block type.
 * Each entry: [fieldKey, label, inputType]
 * inputType: 'text' | 'textarea'
 */
export const BLOCK_FIELDS = {
  hero: [
    ['heading', 'Heading', 'text'],
    ['subheading', 'Subheading', 'text'],
    ['cta_text', 'Button Text', 'text'],
    ['cta_link', 'Button Link', 'text'],
  ],
  text: [
    ['heading', 'Heading', 'text'],
    ['subheading', 'Subheading', 'text'],
    ['body', 'Body', 'textarea'],
  ],
  split: [
    ['heading', 'Heading', 'text'],
    ['body', 'Body Text', 'textarea'],
    ['cta_text', 'Button Text', 'text'],
    ['cta_link', 'Button Link', 'text'],
  ],
  cta: [
    ['heading', 'Headline', 'text'],
    ['subtext', 'Subtext', 'textarea'],
    ['btn_text', 'Button Text', 'text'],
    ['btn_link', 'Button Link', 'text'],
  ],
  cards: [
    ['heading', 'Section Heading', 'text'],
    ['subtext', 'Section Subtext', 'textarea'],
    ['card1_title', 'Card 1 Title', 'text'], ['card1_body', 'Card 1 Body', 'textarea'],
    ['card2_title', 'Card 2 Title', 'text'], ['card2_body', 'Card 2 Body', 'textarea'],
    ['card3_title', 'Card 3 Title', 'text'], ['card3_body', 'Card 3 Body', 'textarea'],
    ['card4_title', 'Card 4 Title', 'text'], ['card4_body', 'Card 4 Body', 'textarea'],
  ],
  faq: [
    ['heading', 'Section Heading', 'text'],
    ['q1', 'Question 1', 'text'], ['a1', 'Answer 1', 'textarea'],
    ['q2', 'Question 2', 'text'], ['a2', 'Answer 2', 'textarea'],
    ['q3', 'Question 3', 'text'], ['a3', 'Answer 3', 'textarea'],
    ['q4', 'Question 4', 'text'], ['a4', 'Answer 4', 'textarea'],
    ['q5', 'Question 5', 'text'], ['a5', 'Answer 5', 'textarea'],
  ],
  pricing: [
    ['heading', 'Section Heading', 'text'],
    ['subtext', 'Section Subtext', 'textarea'],
    ['tier1_name', 'Tier 1 Name', 'text'], ['tier1_price', 'Tier 1 Price', 'text'], ['tier1_features', 'Tier 1 Features', 'textarea'], ['tier1_cta', 'Tier 1 Button', 'text'],
    ['tier2_name', 'Tier 2 Name', 'text'], ['tier2_price', 'Tier 2 Price', 'text'], ['tier2_features', 'Tier 2 Features', 'textarea'], ['tier2_cta', 'Tier 2 Button', 'text'],
    ['tier3_name', 'Tier 3 Name', 'text'], ['tier3_price', 'Tier 3 Price', 'text'], ['tier3_features', 'Tier 3 Features', 'textarea'], ['tier3_cta', 'Tier 3 Button', 'text'],
  ],
  testimonials: [
    ['heading', 'Section Heading', 'text'],
    ['subtext', 'Section Subtext', 'textarea'],
    ['t1_quote', 'Quote 1', 'textarea'], ['t1_name', 'Name 1', 'text'], ['t1_role', 'Role 1', 'text'],
    ['t2_quote', 'Quote 2', 'textarea'], ['t2_name', 'Name 2', 'text'], ['t2_role', 'Role 2', 'text'],
    ['t3_quote', 'Quote 3', 'textarea'], ['t3_name', 'Name 3', 'text'], ['t3_role', 'Role 3', 'text'],
  ],
  stats: [
    ['heading', 'Section Heading', 'text'],
    ['stat1_num', 'Stat 1 Number', 'text'], ['stat1_label', 'Stat 1 Label', 'text'],
    ['stat2_num', 'Stat 2 Number', 'text'], ['stat2_label', 'Stat 2 Label', 'text'],
    ['stat3_num', 'Stat 3 Number', 'text'], ['stat3_label', 'Stat 3 Label', 'text'],
    ['stat4_num', 'Stat 4 Number', 'text'], ['stat4_label', 'Stat 4 Label', 'text'],
  ],
};

/**
 * Dummy/placeholder content per block type — used when adding a new block in the builder.
 */
export const BLOCK_DEFAULTS = {
  hero: {
    heading: 'Welcome to Our Platform',
    subheading: 'Build something extraordinary with the tools you already love.',
    cta_text: 'Get Started',
    cta_link: '#contact',
  },
  text: {
    heading: 'About Our Approach',
    subheading: 'Quality meets innovation',
    body: '<p>We believe great results come from understanding people first. Our approach combines research-driven strategy with hands-on execution to deliver measurable outcomes.</p>',
  },
  split: {
    heading: 'Why Choose Us',
    body: '<p>With years of experience and a passion for excellence, we deliver results that speak for themselves. Our team works closely with you to understand your unique needs.</p>',
    cta_text: 'Learn More',
    cta_link: '#about',
  },
  cta: {
    heading: 'Ready to Get Started?',
    subtext: 'Join hundreds of businesses that trust us to deliver results.',
    btn_text: 'Contact Us',
    btn_link: '#contact',
  },
  cards: {
    heading: 'Our Services',
    subtext: 'Everything you need to succeed',
    card1_title: 'Strategy', card1_body: 'Data-driven planning that aligns with your business goals.',
    card2_title: 'Design', card2_body: 'Beautiful, functional designs that convert visitors into customers.',
    card3_title: 'Development', card3_body: 'Clean, scalable code built with modern best practices.',
    card4_title: 'Support', card4_body: 'Ongoing maintenance and optimization to keep you ahead.',
  },
  faq: {
    heading: 'Frequently Asked Questions',
    q1: 'How do I get started?', a1: 'Simply reach out via our contact form and we\'ll schedule a free consultation.',
    q2: 'What is your pricing?', a2: 'We offer flexible plans tailored to your needs. Contact us for a custom quote.',
    q3: 'How long does a typical project take?', a3: 'Most projects are completed within 4-8 weeks depending on scope.',
    q4: 'Do you offer ongoing support?', a4: 'Yes, all plans include dedicated support and regular check-ins.',
    q5: 'Can I cancel anytime?', a5: 'Absolutely. There are no long-term contracts required.',
  },
  pricing: {
    heading: 'Simple, Transparent Pricing',
    subtext: 'Choose the plan that fits your needs',
    tier1_name: 'Starter', tier1_price: '$29/mo', tier1_features: 'Core features\nEmail support\n1 user', tier1_cta: 'Start Free',
    tier2_name: 'Professional', tier2_price: '$79/mo', tier2_features: 'Everything in Starter\nPriority support\n5 users\nAdvanced analytics', tier2_cta: 'Get Started',
    tier3_name: 'Enterprise', tier3_price: 'Custom', tier3_features: 'Everything in Pro\nDedicated manager\nUnlimited users\nCustom integrations', tier3_cta: 'Contact Sales',
  },
  testimonials: {
    heading: 'What Our Clients Say',
    subtext: 'Trusted by businesses of all sizes',
    t1_quote: 'Working with this team transformed our business. The results exceeded all expectations.', t1_name: 'Sarah Johnson', t1_role: 'CEO, TechCo',
    t2_quote: 'Professional, responsive, and incredibly talented. I couldn\'t recommend them more highly.', t2_name: 'Marcus Chen', t2_role: 'Founder, StartupXYZ',
    t3_quote: 'They delivered on time, on budget, and the quality was outstanding. A true partner.', t3_name: 'Emily Rodriguez', t3_role: 'Director, AgencyOne',
  },
  stats: {
    heading: 'By the Numbers',
    stat1_num: '500+', stat1_label: 'Projects Delivered',
    stat2_num: '98%', stat2_label: 'Client Satisfaction',
    stat3_num: '12+', stat3_label: 'Years Experience',
    stat4_num: '24/7', stat4_label: 'Support Available',
  },
};

/** Block type display metadata — icons + labels for the builder palette */
export const BLOCK_META = {
  hero:         { icon: '◆', label: 'Hero Banner' },
  text:         { icon: '¶', label: 'Text Section' },
  split:        { icon: '◫', label: 'Split Layout' },
  cta:          { icon: '▶', label: 'Call to Action' },
  cards:        { icon: '▦', label: 'Feature Cards' },
  faq:          { icon: '?', label: 'FAQ Accordion' },
  pricing:      { icon: '$', label: 'Pricing Table' },
  testimonials: { icon: '❝', label: 'Testimonials' },
  stats:        { icon: '#', label: 'Stats Row' },
};
