# College Compass: AI-Powered College Guidance Counselor

College Compass is a web application that serves as an AI-powered guidance counselor for high school students. It assesses students' personalities, skills, and interests, then generates personalized educational and career path recommendations, along with a customized high school roadmap to reach their goals.

## Core Objectives

1. Provide accurate, personalized assessment of student aptitudes and interests
2. Match students with appropriate fields of study and career paths
3. Generate customized high school academic plans aligned with college admission requirements
4. Recommend suitable colleges/universities based on student profile and aspirations
5. Deliver actionable guidance throughout high school years

## Technologies Used

- **Frontend**: Next.js with TypeScript, Tailwind CSS, React
- **Backend**: Next.js API routes
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT with bcrypt
- **AI Integration**: OpenAI API and Claude API
- **Data Visualization**: Chart.js with react-chartjs-2

## Getting Started

First, install dependencies:

```bash
npm install
```

Then, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

- `/src/app` - Next.js application router
- `/src/components` - Reusable UI components
- `/src/lib` - Utility functions and shared code
- `/src/models` - MongoDB models
- `/src/app/api` - API routes
- `/src/app/(auth)` - Authentication pages
- `/src/app/dashboard` - User dashboard pages
- `/src/app/assessment` - Assessment modules

## Environment Variables

Create a `.env.local` file with the following variables:

```
MONGODB_URI=
JWT_SECRET=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

## License

MIT
