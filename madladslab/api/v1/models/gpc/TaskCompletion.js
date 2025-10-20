import mongoose from "mongoose";

const taskCompletionSchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    completionDate: {
      type: Date,
      default: Date.now
    },
    stepsCompleted: [{
      step: Number,
      imageUrl: String,
      timestamp: Date,
      notes: String
    }],
    allStepsComplete: {
      type: Boolean,
      default: false
    },
    notes: String,
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    verifiedAt: Date
  },
  {
    timestamps: true
  }
);

// Indexes
taskCompletionSchema.index({ taskId: 1, completionDate: -1 });
taskCompletionSchema.index({ completedBy: 1, completionDate: -1 });

const TaskCompletion = mongoose.model("TaskCompletion", taskCompletionSchema);

export default TaskCompletion;
