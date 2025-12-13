import mongoose, { Schema, Model } from 'mongoose';
import { IChatMessage } from '../types';

const chatMessageSchema = new Schema<IChatMessage>({
  user: {
    type: String,
    required: true,
    lowercase: true
  },
  token: {
    type: String,
    required: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid token address format'
    }
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  reply_to: {
    type: Schema.Types.ObjectId,
    ref: 'ChatMessage',
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

chatMessageSchema.index({ token: 1, timestamp: -1 });
chatMessageSchema.index({ user: 1 });

const ChatMessage: Model<IChatMessage> = mongoose.model<IChatMessage>('ChatMessage', chatMessageSchema);

export default ChatMessage;

