import mongoose, { Schema, Document, HydratedDocument } from 'mongoose';
import bcrypt from 'bcrypt';

export interface IUser extends Document {
  email: string;
  password: string;
  name: string;
  role: 'student' | 'parent' | 'counselor' | 'admin';
  grade: number;
  createdAt: Date;
  updatedAt: Date;
  assessmentResponses: mongoose.Types.ObjectId[] | any[];
  comparePassword: (candidatePassword: string) => Promise<boolean>;
}

const UserSchema: Schema = new Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters long'],
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    role: {
      type: String,
      enum: ['student', 'parent', 'counselor', 'admin'],
      default: 'student',
    },
    grade: {
      type: Number,
      min: 9,
      max: 12,
      default: 9,
    },
    assessmentResponses: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Assessment',
      }
    ],
  },
  { timestamps: true }
);

// Hash password before saving
UserSchema.pre('save', async function (next) {
  const user = this as HydratedDocument<IUser>;

  if (!user.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(user.password, salt);
    user.password = hash;
    next();
  } catch (error) {
    next(error instanceof Error ? error : new Error('Error hashing password'));
  }
});

// Method to compare passwords
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    console.error('Error comparing passwords:', error);
    return false;
  }
};

// Check if the model exists before creating a new one
// This prevents the "Cannot overwrite model once compiled" error
export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema); 