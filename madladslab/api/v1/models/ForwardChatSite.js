import mongoose from "mongoose";
import { randomUUID } from "crypto";

const forwardChatSiteSchema = new mongoose.Schema(
  {
    siteName: {
      type: String,
      required: true,
      trim: true
    },
    siteUrl: {
      type: String,
      required: true,
      trim: true
    },
    // CORS-allowed origin (e.g. "https://example.com")
    origin: {
      type: String,
      default: ''
    },
    plugin: {
      token: {
        type: String,
        unique: true,
        default: () => randomUUID()
      },
      verified: {
        type: Boolean,
        default: false
      },
      installedAt: {
        type: Date,
        default: null
      },
      lastPing: {
        type: Date,
        default: null
      },
      // True once a test API hit has been confirmed from the site
      testHitConfirmed: {
        type: Boolean,
        default: false
      }
    },
    // The agent currently serving this site
    activeAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Agent',
      default: null
    },
    chatMode: {
      type: String,
      enum: ['passive', 'active', 'agent'],
      default: 'active'
    },
    // Soft-disable without removing registration
    enabled: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true,
    collection: 'forwardchatsites'
  }
);

const ForwardChatSite = mongoose.model("ForwardChatSite", forwardChatSiteSchema);
export default ForwardChatSite;
