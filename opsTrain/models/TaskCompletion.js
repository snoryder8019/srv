const mongoose = require('mongoose');

const taskCompletionSchema = new mongoose.Schema({
  task:      { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  brand:     { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', required: true },
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  posPin:    { type: String },
  note:      { type: String, default: '' },
  photoUrl:  { type: String, default: '' },

  // Admin validation
  validated:   { type: Boolean, default: false },
  validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  validatedAt: { type: Date },

  // For date-based querying ("was this done today?")
  shiftDate: { type: String }, // YYYY-MM-DD
  shiftTime: { type: String }  // open / mid / close

}, { timestamps: true });

taskCompletionSchema.index({ task: 1, shiftDate: 1 });
taskCompletionSchema.index({ brand: 1, shiftDate: 1 });

module.exports = mongoose.model('TaskCompletion', taskCompletionSchema);
