import mongoose from "mongoose";

const taskStepSchema = new mongoose.Schema({
  step: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  imageUrl: String, // Photo of completed step
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  completedAt: Date
});

const taskSchema = new mongoose.Schema(
  {
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: true
    },
    title: {
      type: String,
      required: true
    },
    description: String,
    type: {
      type: String,
      enum: ["opening", "closing", "daily", "weekly", "custom"],
      required: true
    },
    department: {
      type: String,
      enum: ["kitchen", "bar", "floor", "all"],
      required: true
    },
    assignedRoles: [{
      type: String,
      enum: ["staff", "manager", "admin"]
    }],
    steps: [taskStepSchema],
    requiresPhotos: {
      type: Boolean,
      default: true
    },
    active: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes
taskSchema.index({ brandId: 1, type: 1, department: 1, active: 1 });
taskSchema.index({ brandId: 1, assignedRoles: 1 });

const Task = mongoose.model("Task", taskSchema);

export default Task;
