import mongoose, { Schema, Document } from 'mongoose';

export interface ICourse {
  name: string;
  courseType: 'regular' | 'honors' | 'ap';
  credits: number;
  semester: 'fall' | 'spring';
  year: number;
  grade?: string; // A+, A, A-, B+, etc.
  completed: boolean;
}

export interface ISemester {
  term: 'fall' | 'spring';
  year: number;
  courses: ICourse[];
  gpa?: number;
}

export interface ICourseTracker extends Document {
  userId: mongoose.Types.ObjectId;
  semesters: ISemester[];
  cumulativeGpa: number;
  totalCredits: number;
  createdAt: Date;
  updatedAt: Date;
}

const CourseSchema = new Schema<ICourse>({
  name: {
    type: String,
    required: [true, 'Course name is required'],
    trim: true,
  },
  courseType: {
    type: String,
    enum: ['regular', 'honors', 'ap'],
    default: 'regular',
  },
  credits: {
    type: Number,
    required: [true, 'Credits are required'],
    default: 1,
    min: 0.5,
    max: 5,
  },
  semester: {
    type: String,
    enum: ['fall', 'spring'],
    required: [true, 'Semester is required'],
  },
  year: {
    type: Number,
    required: [true, 'Year is required'],
  },
  grade: {
    type: String,
    enum: ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F', 'I', 'W', 'P'],
    default: null,
  },
  completed: {
    type: Boolean,
    default: false,
  },
});

const SemesterSchema = new Schema<ISemester>({
  term: {
    type: String,
    enum: ['fall', 'spring'],
    required: [true, 'Term is required'],
  },
  year: {
    type: Number,
    required: [true, 'Year is required'],
  },
  courses: [CourseSchema],
  gpa: {
    type: Number,
    default: 0,
  },
});

const CourseTrackerSchema = new Schema<ICourseTracker>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    semesters: [SemesterSchema],
    cumulativeGpa: {
      type: Number,
      default: 0,
    },
    totalCredits: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export default mongoose.models.CourseTracker || mongoose.model<ICourseTracker>('CourseTracker', CourseTrackerSchema); 