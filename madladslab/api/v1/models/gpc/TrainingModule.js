import mongoose from "mongoose";

const sectionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  videoUrl: String,
  imageUrls: [String],
  order: {
    type: Number,
    required: true
  }
});

const quizQuestionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true
  },
  options: [{
    type: String,
    required: true
  }],
  correctAnswer: {
    type: Number,
    required: true
  },
  order: {
    type: Number,
    required: true
  }
});

const trainingModuleSchema = new mongoose.Schema(
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
    description: {
      type: String,
      required: true
    },
    category: {
      type: String,
      enum: ["handbook", "safety", "skills", "procedures", "compliance", "other"],
      required: true
    },
    targetRoles: [{
      type: String,
      enum: ["staff", "manager", "admin", "all"]
    }],
    sections: [sectionSchema],
    quiz: [quizQuestionSchema],
    passingScore: {
      type: Number,
      default: 70
    },
    estimatedDuration: {
      type: Number, // in minutes
      required: true
    },
    required: {
      type: Boolean,
      default: false
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
trainingModuleSchema.index({ brandId: 1, category: 1, active: 1 });
trainingModuleSchema.index({ brandId: 1, targetRoles: 1 });
trainingModuleSchema.index({ brandId: 1 });

const TrainingModule = mongoose.model("TrainingModule", trainingModuleSchema);

export default TrainingModule;
