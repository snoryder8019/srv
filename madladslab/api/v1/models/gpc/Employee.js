import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true
    },
    role: {
      type: String,
      enum: ["staff", "manager", "admin"],
      default: "staff"
    },
    position: {
      type: String,
      required: true
    },
    department: {
      type: String,
      enum: ["kitchen", "bar", "floor", "management", "other"],
      required: true
    },
    hireDate: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ["active", "inactive", "terminated"],
      default: "active"
    },
    onboardingCompleted: {
      type: Boolean,
      default: false
    },
    onboardingCompletedDate: {
      type: Date
    },
    trainingModulesCompleted: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrainingModule"
    }],
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  {
    timestamps: true
  }
);

// Indexes
employeeSchema.index({ userId: 1 });
employeeSchema.index({ role: 1, status: 1 });
employeeSchema.index({ department: 1, status: 1 });

const Employee = mongoose.model("Employee", employeeSchema);

export default Employee;
