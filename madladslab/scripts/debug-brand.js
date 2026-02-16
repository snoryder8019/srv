import mongoose from 'mongoose';
import Employee from '../api/v1/models/gpc/Employee.js';
import Brand from '../api/v1/models/gpc/Brand.js';
import User from '../api/v1/models/User.js';

const DB_URL = process.env.DB_URL || 'mongodb+srv://snoryder8019:51DUBsqu%40red51@cluster0.tpmae.mongodb.net/madLadsLab';

async function main() {
  await mongoose.connect(DB_URL);
  console.log('Connected');

  // Find the brand we just created
  const brand = await Brand.findOne({ name: 'Graffit Pasta' });
  console.log('Brand:', brand ? `${brand._id} (${brand.slug})` : 'not found');

  if (brand) {
    // Find employees for this brand
    const employees = await Employee.find({ brandId: brand._id });
    console.log('Employees for brand:', employees.length);
    employees.forEach(e => {
      console.log(' -', e.userId.toString(), e.role, e.status);
    });
  }

  // Find all users with backoffice access
  const users = await User.find({ 'backoffice.brands': { $exists: true, $ne: [] } });
  console.log('\nUsers with backoffice brands:', users.length);

  for (const user of users) {
    console.log(`\nUser: ${user.email} (${user._id})`);
    if (user.backoffice && user.backoffice.brands) {
      for (const b of user.backoffice.brands) {
        console.log(`  Brand: ${b.brandId}, Role: ${b.role}, Status: ${b.status}`);

        // Check if employee exists
        const emp = await Employee.findOne({ userId: user._id, brandId: b.brandId });
        console.log(`  Employee record: ${emp ? `${emp._id} (${emp.status})` : 'NOT FOUND'}`);
      }
    }
  }

  await mongoose.disconnect();
  console.log('\nDone');
}

main().catch(console.error);
