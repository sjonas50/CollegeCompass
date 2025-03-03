import mongoose, { Schema, Document } from 'mongoose';
import { IUser } from './User';

// Defining assessment types
export enum AssessmentType {
  PERSONALITY = 'personality',
  SKILLS = 'skills',
  INTERESTS = 'interests',
  APTITUDE = 'aptitude',
}

export interface AssessmentOption {
  id: string;
  text: string;
  value: string | number;
}

export interface AssessmentQuestion {
  id: string;
  text: string;
  type: 'scale' | 'multiple_choice' | 'open_ended';
  options?: AssessmentOption[];
}

export interface AssessmentResponse {
  questionId: string;
  questionText: string;
  response: string | number;
  assessmentType: AssessmentType;
}

export interface AssessmentResult {
  category: string;
  score: number;
  description: string;
}

export interface AIRecommendation {
  // Define the structure of AIRecommendation
}

export interface UserAssessment {
  _id?: string;
  userId: string;
  assessmentType: AssessmentType;
  responses: AssessmentResponse[];
  completedAt: Date;
  recommendations?: AIRecommendation[]; // Will be populated by AI analysis
}

export interface IAssessment extends Document {
  user: IUser['_id'];
  type: AssessmentType;
  completedAt: Date;
  responses: AssessmentResponse[];
  results: AssessmentResult[];
  rawScore?: number;
  valid: boolean;
}

const AssessmentSchema: Schema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(AssessmentType),
      required: true,
    },
    completedAt: {
      type: Date,
      default: Date.now,
    },
    responses: [
      {
        questionId: {
          type: String,
          required: true,
        },
        response: {
          type: Schema.Types.Mixed,
          required: true,
        },
      },
    ],
    results: [
      {
        category: {
          type: String,
          required: true,
        },
        score: {
          type: Number,
          required: true,
        },
        description: {
          type: String,
          required: true,
        },
      },
    ],
    rawScore: {
      type: Number,
    },
    valid: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Create index for faster queries
AssessmentSchema.index({ user: 1, type: 1, completedAt: -1 });

export default mongoose.models.Assessment || mongoose.model<IAssessment>('Assessment', AssessmentSchema); 