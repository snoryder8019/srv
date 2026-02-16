import mongoose from 'mongoose';
import Employee from '../api/v1/models/gpc/Employee.js';

const DB_URL = process.env.DB_URL || 'mongodb+srv://snoryder8019:51DUBsqu%40red51@cluster0.tpmae.mongodb.net/madLadsLab';

async function fixEmployee() {
  await mongoose.connect(DB_URL);
  console.log('Connected');

  const userId = '68a3a417771cb7e959aeb926';
  const brandId = '691e1dad444a3699e08e2c86';

  // Check if employee exists
  let employee = await Employee.findOne({ userId, brandId });
  console.log('Existing employee:', employee);

  if (!employee) {
    console.log('Creating employee record...');
    employee = new Employee({
      brandId,
      userId,
      role: 'admin',
      position: 'Owner',
      department: 'management',
      status: 'active'
    });

    try {
      await employee.save();
      console.log('Employee created:', employee._id);
    } catch (err) {
      console.error('Error creating employee:', err.message);
      console.error('Full error:', err);
    }
  } else {
    console.log('Employee already exists');
  }

  await mongoose.disconnect();
  console.log('Done');
}

fixEmployee().catch(console.error);
