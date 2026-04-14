const SiteContent = require('../models/SiteContent');

const defaults = [
  {
    section: 'hero',
    heading: 'Mobile Meadows',
    subheading: 'Mobile RV & Motorhome Repair -- Branson, MO',
    body: '',
    buttonText: 'Book a Service',
    buttonLink: '/calendar'
  },
  {
    section: 'mobile-repair',
    heading: 'Mobile RV & Motorhome Repair',
    body: 'On-site repair and service for RVs and motorhomes. We come to you anywhere in the Branson, MO area.',
    buttonText: 'View Availability',
    buttonLink: '/calendar?service=mobile-repair'
  },
  {
    section: 'roof-repair',
    heading: 'RV Roof Repair',
    body: 'Specialized RV rooftop repair at our garage facility. Inspection, patching, coating, and full replacement.',
    buttonText: 'Book Roof Service',
    buttonLink: '/calendar?service=roof-repair'
  },
  {
    section: 'about',
    heading: 'About Mobile Meadows',
    body: 'Serving Branson, Missouri and the surrounding areas with reliable, professional RV and motorhome repair services — mobile and in-shop.'
  },
  {
    section: 'contact',
    heading: 'Contact Us',
    body: 'Reach out to schedule a service or get a quote for your RV or motorhome repair needs.'
  },
  {
    section: 'footer',
    heading: 'Mobile Meadows',
    body: 'Mobile RV & Motorhome Repair | Roof Repair Services'
  }
];

async function seedContent() {
  let seeded = 0;
  for (const def of defaults) {
    const exists = await SiteContent.findOne({ section: def.section });
    if (!exists) {
      await SiteContent.create(def);
      seeded++;
      console.log(`Seeded section: ${def.section}`);
    }
  }
  if (seeded === 0) console.log('SiteContent: all sections already exist');
  else console.log(`SiteContent: seeded ${seeded} sections`);
}

module.exports = seedContent;
