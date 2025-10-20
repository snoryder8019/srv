import mongoose from "mongoose";

const documentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: String,
  fileUrl: String,
  required: {
    type: Boolean,
    default: false
  },
  completed: {
    type: Boolean,
    default: false
  },
  completedDate: Date,
  signatureUrl: String
});

const onboardingPacketSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true
    },
    status: {
      type: String,
      enum: ["pending", "in-progress", "completed"],
      default: "pending"
    },
    documents: [documentSchema],
    welcomeMessage: String,
    startDate: {
      type: Date,
      required: true
    },
    completionDate: Date,
    assignedBy: {
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
onboardingPacketSchema.index({ employeeId: 1 });
onboardingPacketSchema.index({ status: 1 });

const OnboardingPacket = mongoose.model("OnboardingPacket", onboardingPacketSchema);

export default OnboardingPacket;
