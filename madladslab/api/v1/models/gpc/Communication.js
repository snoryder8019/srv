import mongoose from "mongoose";

const reactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  emoji: {
    type: String,
    required: true
  }
}, { _id: false });

const commentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  content: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const communicationSchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    title: {
      type: String,
      required: true
    },
    content: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ["announcement", "update", "event", "discussion", "celebration"],
      required: true
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium"
    },
    targetAudience: [{
      type: String,
      enum: ["all", "staff", "manager", "admin", "kitchen", "bar", "floor"]
    }],
    imageUrls: [String],
    reactions: [reactionSchema],
    comments: [commentSchema],
    pinned: {
      type: Boolean,
      default: false
    },
    readBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }]
  },
  {
    timestamps: true
  }
);

// Indexes
communicationSchema.index({ createdAt: -1 });
communicationSchema.index({ authorId: 1 });
communicationSchema.index({ type: 1, pinned: 1 });
communicationSchema.index({ targetAudience: 1 });

const Communication = mongoose.model("Communication", communicationSchema);

export default Communication;
