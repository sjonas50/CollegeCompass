import mongoose, { Schema, Document } from 'mongoose';

export interface CourseRecommendation {
  name: string;
  description: string;
  type: 'required' | 'elective' | 'advanced';
  year: 9 | 10 | 11 | 12;
  semester: 'Fall' | 'Spring' | 'Both';
  credits: number;
  prerequisites?: string[];
}

export interface AcademicPlanData {
  focusAreas: string[];
  careerAlignment: string[];
  fourYearPlan: {
    freshman: CourseRecommendation[];
    sophomore: CourseRecommendation[];
    junior: CourseRecommendation[];
    senior: CourseRecommendation[];
  };
  extracurricularRecommendations: string[];
  summerActivities: string[];
  postGraduationRecommendations: string[];
}

export interface IAcademicPlan extends Document {
  userId: mongoose.Types.ObjectId;
  plan: AcademicPlanData;
  createdAt: Date;
  updatedAt: Date;
}

const CourseRecommendationSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['required', 'elective', 'advanced'],
    required: true,
  },
  year: {
    type: Number,
    enum: [9, 10, 11, 12],
    required: true,
  },
  semester: {
    type: String,
    enum: ['Fall', 'Spring', 'Both'],
    required: true,
  },
  credits: {
    type: Number,
    required: true,
  },
  prerequisites: {
    type: [String],
    default: [],
  },
});

const FourYearPlanSchema = new Schema({
  freshman: {
    type: [CourseRecommendationSchema],
    default: [],
  },
  sophomore: {
    type: [CourseRecommendationSchema],
    default: [],
  },
  junior: {
    type: [CourseRecommendationSchema],
    default: [],
  },
  senior: {
    type: [CourseRecommendationSchema],
    default: [],
  },
});

const AcademicPlanSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    plan: {
      focusAreas: {
        type: [String],
        required: true,
      },
      careerAlignment: {
        type: [String],
        required: true,
      },
      fourYearPlan: {
        type: FourYearPlanSchema,
        required: true,
      },
      extracurricularRecommendations: {
        type: [String],
        required: true,
      },
      summerActivities: {
        type: [String],
        required: true,
      },
      postGraduationRecommendations: {
        type: [String],
        required: true,
      },
    },
  },
  { timestamps: true }
);

// Create index for faster queries
AcademicPlanSchema.index({ userId: 1 });

export default mongoose.models.AcademicPlan || mongoose.model<IAcademicPlan>('AcademicPlan', AcademicPlanSchema); 