import mongoose from "mongoose";

const trainingProgressSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true
    },
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrainingModule",
      required: true
    },
    status: {
      type: String,
      enum: ["not-started", "in-progress", "completed", "failed"],
      default: "not-started"
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    quizAttempts: [{
      attemptDate: {
        type: Date,
        default: Date.now
      },
      score: Number,
      passed: Boolean,
      answers: [Number]
    }],
    completionDate: Date,
    certificateUrl: String
  },
  {
    timestamps: true
  }
);

// Indexes
trainingProgressSchema.index({ employeeId: 1, moduleId: 1 }, { unique: true });
trainingProgressSchema.index({ status: 1 });

const TrainingProgress = mongoose.model("TrainingProgress", trainingProgressSchema);

export default TrainingProgress;
