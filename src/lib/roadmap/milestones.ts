import type { Milestone } from "./types";

/**
 * The grade 7–12 roadmap library. Drafted per grade, then checked by a web-verifying fact-checker
 * (official sources: studentaid.gov, College Board, ACT, ed.gov, apprenticeship.gov, sss.gov, …) and
 * a counselor-perspective reviewer for reading level, tone and equity, then revised and reviewed
 * again across all grades for gaps and duplicates.
 *
 * Some items quote this school year's dates or fees. Re-verify every item against its sources each
 * summer and bump VERIFIED_FOR_SCHOOL_YEAR; a test fails once the verified year has ended.
 * Ids are stored with students' progress: never change or reuse an id.
 */
export const VERIFIED_FOR_SCHOOL_YEAR = 2026; // the 2026–27 school year

export const MILESTONES: Milestone[] = [
  {
    "id": "g7-meet-your-counselor",
    "grade": 7,
    "months": [
      8,
      9
    ],
    "title": "Find out who your school counselor is",
    "detail": "Ask the front office who your counselor is. Stop by to say hi and ask how to set up a time to talk. If your family speaks Spanish or another language, ask if the school can help them in that language. If something makes school hard, like getting there or no internet at home, your counselor can help.",
    "why": "Your counselor helps with classes, programs, and problems. It's easier to ask for help from someone you already know.",
    "category": "habits",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g7-set-up-a-planner",
    "grade": 7,
    "months": [
      8,
      9
    ],
    "title": "Set up a planner and check your grades weekly",
    "detail": "Pick one place to write every assignment and due date, like a paper planner or a notes app. Once a week, check your school's grade portal (or ask your teacher). If you missed something, ask how to make it up. If a class feels hard, ask when your teacher gives extra help.",
    "why": "Small habits now make high school easier. A missing assignment is much easier to handle when you catch it early.",
    "category": "habits",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g7-try-one-activity",
    "grade": 7,
    "months": [
      9,
      10
    ],
    "title": "Try one club, sport, or activity this fall",
    "detail": "Pick one new thing to try: a school club, a sport, band, art, robotics, a community or faith group, or helping in your neighborhood. Many school clubs are free. If something costs money or you need a ride home, ask the coach or leader what help there is. It's okay to switch if it isn't a fit.",
    "why": "Trying things helps you find what you enjoy. It also builds skills and friendships you'll carry into high school.",
    "category": "activities_summer",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g7-get-a-library-card",
    "grade": 7,
    "months": [
      10
    ],
    "title": "Get your own public library card",
    "detail": "Visit your public library with a family member and ask for a card. Ask what to bring, like mail with your address. Then ask what students can use: e-books, homework help, computers, study rooms, and maybe laptops or Wi-Fi hotspots to borrow. Can't get there? Ask about signing up online or through your school.",
    "why": "A library card opens the door to books, homework help, computers, and quiet study space all year long.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://www.ala.org/conferencesevents/celebrationweeks/card"
    ]
  },
  {
    "id": "g7-practice-math-khan-academy",
    "grade": 7,
    "months": [
      10,
      11
    ],
    "title": "Practice math for free on Khan Academy",
    "detail": "Ask if your class already uses Khan Academy. If not, sign up free. Under 13? A parent, guardian, or teacher helps set up your account. Practice 7th grade math 15-20 minutes a few times a week, on your class's topic. No internet at home? Use a school or library computer. There's a Spanish site too: es.khanacademy.org.",
    "why": "Strong 7th grade math gets you ready for 8th grade math and Algebra I, which open doors to many high school classes.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://www.khanacademy.org/math/cc-seventh-grade-math",
      "https://es.khanacademy.org/math/cc-seventh-grade-math",
      "https://support.khanacademy.org/hc/en-us/articles/202487460-If-my-child-is-younger-than-age-13-what-login-options-are-there"
    ]
  },
  {
    "id": "g7-ask-about-gear-up-talent-search",
    "grade": 7,
    "months": [
      11
    ],
    "title": "Ask if your school has GEAR UP or Talent Search",
    "detail": "Ask your counselor if your school has GEAR UP or Talent Search. These free programs are paid for by the U.S. government. They help with things like tutoring, mentoring, learning about careers, and visiting colleges. Not every school has one, and programs can change from year to year, so ask what's there this year.",
    "why": "These programs help students whose families may be new to college or need extra help. They can stay with you all through high school.",
    "category": "college_search",
    "pathway": "all",
    "sources": [
      "https://www.ed.gov/grants-and-programs/grants-higher-education/federal-trio-programs/talent-search-program-84044",
      "https://www.ecfr.gov/current/title-34/subtitle-B/chapter-VI/part-643",
      "https://www.ed.gov/grants-and-programs/grants-special-populations/grants-economically-disadvantaged-students/gaining-early-awareness-and-readiness-undergraduate-programs-gear-partnership-84334a",
      "https://www.ecfr.gov/current/title-34/subtitle-B/chapter-VI/part-694"
    ]
  },
  {
    "id": "g7-learn-high-school-choices",
    "grade": 7,
    "months": [
      11,
      12
    ],
    "title": "Find out what high school choices you'll have",
    "detail": "Ask your counselor or check your district's website. Do students go to their neighborhood high school, or can they apply to others? Examples: CTE schools that teach job skills, magnet schools with a focus like art, and early college schools with college classes. Ask when applications open and if 7th-grade grades count.",
    "why": "In some places, like New York City right now, 7th-grade grades count for some high schools, and applications open early in 8th grade. Knowing now gives you time to plan.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://www.schools.nyc.gov/enrollment/enroll-grade-by-grade/high-school/screened-admissions",
      "https://www.schools.nyc.gov/enrollment/enroll-grade-by-grade/high-school"
    ]
  },
  {
    "id": "g7-take-career-interest-quiz",
    "grade": 7,
    "months": [
      12
    ],
    "title": "Take the Interests quiz",
    "detail": "On your Home page, take the Interests quiz: 60 quick activities, about 10 minutes. Want it in Spanish? Use the Interest Profiler on Mi Próximo Paso (a school or library computer works). Then read about 3 careers it suggests. Notice the training each one needs: a college degree, an apprenticeship, or a certificate.",
    "why": "Knowing what you enjoy helps you choose classes and activities, and shows you there are many good paths after high school.",
    "category": "career_exploration",
    "pathway": "all",
    "sources": [
      "https://www.miproximopaso.org/",
      "https://www.onetcenter.org/spanish.html",
      "https://www.mynextmove.org/"
    ]
  },
  {
    "id": "g7-ask-about-8th-grade-math",
    "grade": 7,
    "months": [
      1,
      2,
      3
    ],
    "title": "Plan your 8th-grade classes, starting with math",
    "detail": "Ask your counselor when 8th-grade sign-ups are. Ask your math teacher which math you'll take and how that's decided. If your school has Algebra I in 8th grade, ask what you'd need to be ready. Taking it in 9th is okay too; many students do. Then pick an elective that sounds fun, like tech, art, or a career class.",
    "why": "Where it's offered, Algebra I in 8th grade leaves room for more math later, and 9th grade still keeps college and training open. Electives help you find what you love.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://studentaid.gov/resources/prepare-for-college/checklists/middle-school"
    ]
  },
  {
    "id": "g7-learn-there-is-help-paying",
    "grade": 7,
    "months": [
      1,
      2
    ],
    "title": "Ask about money for college or training",
    "detail": "Ask your counselor if your state has a scholarship you sign up for in 7th or 8th grade, like Indiana's 21st Century Scholars or Washington's College Bound, and if you're signed up or need to do anything. With family, read StudentAid.gov's free guide (in Spanish too). Grants usually don't have to be paid back.",
    "why": "Grants and state scholarships can help pay for college or career school. Some state sign-ups close at the end of 8th grade, and rules differ by state.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://learnmoreindiana.org/scholars/enrollment-eligibility/",
      "https://wsac.wa.gov/college-bound",
      "https://studentaid.gov/sites/default/files/do-you-need-money.pdf",
      "https://studentaid.gov/sites/default/files/do-you-need-money-spanish.pdf",
      "https://studentaid.gov/understand-aid/types/grants"
    ]
  },
  {
    "id": "g7-visit-a-campus",
    "grade": 7,
    "months": [
      3,
      4
    ],
    "title": "Visit a college or training campus",
    "detail": "Visit a place where people learn after high school: a community college, a trade or technical school, or a university. Ask your counselor about school trips, or go with family to an open house or event. Can't get there? Take an online tour. Look for classrooms, hands-on labs or shops, and where students hang out.",
    "why": "Seeing a campus makes it feel real. Many students find out it's a place where they could belong.",
    "category": "college_search",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g7-learn-about-apprenticeships",
    "grade": 7,
    "months": [
      4,
      5
    ],
    "title": "Learn how apprenticeships work",
    "detail": "Explore apprenticeship.gov (a school or library computer works). An apprenticeship is a paid job where you learn from a mentor, take classes, and earn a credential (proof of your skills). Some start at 16 during high school; others require you to be 18. For now, just explore. Write down 2 jobs that sound interesting.",
    "why": "Learning about paid training now helps you pick high school classes that fit, whether you choose training, college, or both.",
    "category": "career_exploration",
    "pathway": "training",
    "sources": [
      "https://www.apprenticeship.gov/career-seekers",
      "https://www.apprenticeship.gov/educators/apprenticeship-for-young-people",
      "https://www.ecfr.gov/current/title-29/subtitle-A/part-29"
    ]
  },
  {
    "id": "g7-find-a-summer-activity",
    "grade": 7,
    "months": [
      5,
      6,
      7
    ],
    "title": "Find a free or low-cost summer activity",
    "detail": "In May, ask your public library about its summer reading challenge and teen events; many are free. Also check your city's parks and recreation department or 4-H (youth clubs and camps run with public universities). Look for places you can walk or bus to, and ask about fee help. Read something you pick most days.",
    "why": "Summer is a great time to try new things and keep your brain active, so starting 8th grade feels easier.",
    "category": "activities_summer",
    "pathway": "all",
    "sources": [
      "https://libguides.ala.org/summer-reading",
      "https://www.nypl.org/summer",
      "https://4-h.org/about/",
      "https://4-h.org/about/find/"
    ]
  },
  {
    "id": "g7-ask-adults-about-their-jobs",
    "grade": 7,
    "months": [
      6,
      7
    ],
    "title": "Ask 3 adults about their jobs",
    "detail": "Ask family, neighbors, or coaches: What do you do all day? What training did you need? What do you wish you knew at my age? Then look up one of their jobs on the government's free student career site (bls.gov/k12) to learn what the work is like, what it pays, and how people get that job.",
    "why": "Real stories show you the many ways people build careers: through college, training, or learning on the job.",
    "category": "career_exploration",
    "pathway": "all",
    "sources": [
      "https://www.bls.gov/k12/",
      "https://www.bls.gov/k12/students/careers/career-exploration.htm",
      "https://www.bls.gov/ooh/"
    ]
  },
  {
    "id": "g8-set-up-a-planner",
    "grade": 8,
    "months": [
      8,
      9
    ],
    "title": "Set up a planner for 8th grade",
    "detail": "Use a paper planner (ask if your school gives them out free) or a phone calendar. Write down every assignment and test the day you get it. Once a week, check for missing work in your school's grade portal or by asking your teachers. If a grade slips, ask that teacher for one thing you can do to bring it up.",
    "why": "Strong habits make high school easier. There, your grades go on your transcript, the official school record that colleges and training programs look at.",
    "category": "habits",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g8-take-career-interest-quiz",
    "grade": 8,
    "months": [
      8,
      9
    ],
    "title": "Take the Interests quiz in College Compass",
    "detail": "On your Home page, take the Interests quiz: 60 quick activities, about 10 minutes. Took it last year? Take it again, since interests change. Pick 3 career matches that sound fun and open each one to see what training or degree it needs. Share them with a family member or your counselor.",
    "why": "Knowing what you like helps you pick a high school program and classes, and shows how many good jobs start with college or career training.",
    "category": "career_exploration",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g8-find-out-about-high-school-choices",
    "grade": 8,
    "months": [
      9,
      10
    ],
    "title": "Find out if you need to apply to high school",
    "detail": "Some districts have 8th graders apply to magnet schools (built on a theme like science), CTE programs (hands-on classes for a job field like health care), or early college (college classes in high school). Ask your counselor about your choices and deadlines. Some programs need a test, with sign-up as early as October.",
    "why": "Some deadlines come early in 8th grade. Knowing them now means you won't miss a program you would love.",
    "category": "applications",
    "pathway": "all",
    "sources": [
      "https://www.cps.edu/gocps/",
      "https://www.schools.nyc.gov/enrollment/enroll-grade-by-grade/high-school",
      "https://tea.texas.gov/student-readiness-and-high-school/college-career-and-military-prep/early-college-high-school-echs"
    ]
  },
  {
    "id": "g8-turn-in-high-school-applications",
    "grade": 8,
    "months": [
      10,
      11
    ],
    "title": "Visit high schools and turn in your application",
    "detail": "Visit open houses, in person or online, before your application is due. Then fill it out with family or your counselor (ask for Spanish if that helps). List schools in the order you truly want them. Sign up early for any test or audition. Some deadlines are in mid-November, so don't wait. Save a copy.",
    "why": "Seeing schools helps you pick one that fits, and applying on time keeps all your choices open. Your counselor can help if you get stuck.",
    "category": "applications",
    "pathway": "all",
    "sources": [
      "https://www.cps.edu/gocps/",
      "https://www.schools.nyc.gov/enrollment/enroll-grade-by-grade/high-school"
    ]
  },
  {
    "id": "g8-take-psat-8-9",
    "grade": 8,
    "months": [
      10,
      3,
      4
    ],
    "title": "Take the PSAT 8/9 if your school offers it",
    "detail": "Your school or district decides if and when to give the PSAT 8/9 (usually October or March-April) and signs you up. Some schools give the PreACT 8/9 instead. You'll usually test on a school computer in an app called Bluebook, with a short practice preview first. No need to cram. Ask your counselor for the date.",
    "why": "It's a starting point, not a pass-or-fail test. Your score report shows skills to work on and some growing careers in your state.",
    "category": "testing",
    "pathway": "all",
    "sources": [
      "https://satsuite.collegeboard.org/sat/dates-deadlines",
      "https://counselors.collegeboard.org/assessments/psat-8-9/overview-dates",
      "https://satsuite.collegeboard.org/media/pdf/psat-8-9-student-guide.pdf",
      "https://www.act.org/content/act/en/products-and-services/preact.html"
    ]
  },
  {
    "id": "g8-check-for-a-state-sign-up-scholarship",
    "grade": 8,
    "months": [
      11,
      12
    ],
    "title": "See if your state has a scholarship you sign up for now",
    "detail": "Some states help pay for college or training if you sign up in middle school. Indiana's 21st Century Scholars deadline is June 30 of 8th grade. Oklahoma's Promise takes 8th-11th graders. Some states sign up students who get free or reduced-price meals, so turn in your meal form. Ask your counselor: \"Am I signed up?\"",
    "why": "These programs can pay a big part of tuition later. Checking now makes sure you don't miss a sign-up deadline.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://learnmoreindiana.org/scholars/enrollment-eligibility/",
      "https://learnmoreindiana.org/scholars/",
      "https://okpromise.org/scholarship-deadlines.shtml",
      "https://okpromise.org/",
      "https://wsac.wa.gov/college-bound"
    ]
  },
  {
    "id": "g8-explore-cte-pathways",
    "grade": 8,
    "months": [
      12,
      1
    ],
    "title": "See which career-tech pathways high school offers",
    "detail": "Ask your counselor for your high school's list of CTE pathways. A pathway is a set of career classes that build each year, in fields like health care, computers, or building trades. Some end with an industry credential (proof of job skills) or college credit. Pick 1 or 2 that sound fun and ask when you can start.",
    "why": "Starting a pathway early gives you time to finish it. It can lead to a job, an apprenticeship, or more college, whichever you choose.",
    "category": "career_exploration",
    "pathway": "training",
    "sources": [
      "https://www.law.cornell.edu/uscode/text/20/2302",
      "https://www.apprenticeship.gov/educators/apprenticeship-for-young-people"
    ]
  },
  {
    "id": "g8-pick-your-9th-grade-classes",
    "grade": 8,
    "months": [
      1,
      2,
      3
    ],
    "title": "Pick 9th-grade classes and sketch a 4-year plan",
    "detail": "Ask your counselor what 9th-grade math you're placed in and how to move up if you're ready. Plan 4 years around your state's graduation rules. College-bound? Add English every year, 3-4 years of math and lab science, social studies, and 2 years of one language. Career training? Add CTE classes that build each year.",
    "why": "Starting with Algebra I in 9th grade is fine. Taking math every year still gets you the 3-4 years colleges look for. You can change your plan later.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://bigfuture.collegeboard.org/plan-for-college/stand-out-in-high-school/high-school-classes-colleges-look-for",
      "https://www.apprenticeship.gov/educators/apprenticeship-for-young-people"
    ]
  },
  {
    "id": "g8-accept-your-high-school-spot",
    "grade": 8,
    "months": [
      2,
      3
    ],
    "title": "Say yes to your high school spot",
    "detail": "If you applied, watch for your offer. In NYC and Chicago, offers come in February or March. Read it with family or your counselor. If you must accept it, do it by the deadline. Unhappy? Ask about waitlists. Going to your neighborhood high school? Ask if you need to fill out sign-up forms, in Spanish if that helps.",
    "why": "In many districts, your spot isn't saved until you accept it. Finishing this now means a calmer summer.",
    "category": "applications",
    "pathway": "all",
    "sources": [
      "https://www.cps.edu/gocps/",
      "https://www.schools.nyc.gov/enrollment/enroll-grade-by-grade/high-school"
    ]
  },
  {
    "id": "g8-ask-about-upward-bound-and-talent-search",
    "grade": 8,
    "months": [
      4,
      5
    ],
    "title": "Ask about Upward Bound and Talent Search",
    "detail": "These U.S. government programs help students from low-income families or whose parents don't have a 4-year degree. Talent Search serves grade 6 and up. Upward Bound starts after 8th grade (ages 13-19) and has a summer program. Each serves certain schools or areas, so ask your counselor. Ask about GEAR UP too.",
    "why": "They give extra help with classes and planning for college or career school, a lot like having your own coach.",
    "category": "college_search",
    "pathway": "all",
    "sources": [
      "https://www.ed.gov/grants-and-programs/grants-higher-education/federal-trio-programs/upward-bound-program-84047a",
      "https://www.ed.gov/grants-and-programs/grants-higher-education/federal-trio-programs/talent-search-program-84044",
      "https://www.ed.gov/grants-and-programs/grants-higher-education/trio-home-page",
      "https://www.ecfr.gov/current/title-34/subtitle-B/chapter-VI/part-645",
      "https://www.ed.gov/grants-and-programs/grants-special-populations/grants-economically-disadvantaged-students/gaining-early-awareness-and-readiness-undergraduate-programs-gear"
    ]
  },
  {
    "id": "g8-try-something-new-this-summer",
    "grade": 8,
    "months": [
      5,
      6
    ],
    "title": "Line up something new for this summer",
    "detail": "Ask your public library, parks department, or community center about free teen programs this summer. Some fill up fast, so ask early. Ask if your city has a summer job program for teens, too. Or ask a family friend or neighbor if you can spend a day seeing their work. Write down what you liked and what you didn't.",
    "why": "Trying new things shows you what you enjoy, which makes picking classes and careers easier.",
    "category": "activities_summer",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g8-keep-math-sharp-this-summer",
    "grade": 8,
    "months": [
      6,
      7
    ],
    "title": "Keep your math sharp this summer",
    "detail": "Spend 20 minutes, 3 days a week, on Khan Academy. It's free and in Spanish too. Take the course challenge (a quiz) for the math class you just finished to see what to review, then get a head start on your 9th-grade class, like Algebra I. No internet at home? Use a library computer.",
    "why": "A little practice over the summer helps you start 9th-grade math feeling ready instead of rusty.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://www.khanacademy.org/about",
      "https://blog.khanacademy.org/khan-academy-en-espanol/"
    ]
  },
  {
    "id": "g8-get-ready-for-high-school",
    "grade": 8,
    "months": [
      7
    ],
    "title": "Get ready for your first week of high school",
    "detail": "Go to freshman orientation or a summer bridge program (a short summer program for new 9th graders) if your high school has one. Before day one, find your schedule, how you'll get to school, and your counselor's name. Learn how to check your grades. Have an IEP or 504 plan? Make sure your new school has it.",
    "why": "Knowing where to go and who to ask makes the first days calmer, so you can focus on a strong start.",
    "category": "habits",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g9-meet-your-counselor",
    "grade": 9,
    "months": [
      8,
      9
    ],
    "title": "Introduce yourself to your school counselor",
    "detail": "In the first weeks, stop by the counseling office or ask how to set up a short meeting. Ask: How many credits (what you earn for passing a class) do I need to graduate? Where can I get help if a class gets hard? Is there help with test or activity fees? Can the school send news home in my family's language?",
    "why": "Counselors help a lot of students, so a quick hello helps them remember you and your goals.",
    "category": "habits",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g9-join-one-activity",
    "grade": 9,
    "months": [
      9,
      10
    ],
    "title": "Try one club, team, or activity",
    "detail": "Go to the club fair or ask the front office for a club list. Career clubs count too, like SkillsUSA (trades and tech), HOSA (health careers), or FFA (agriculture). No ride home late? Ask about lunch clubs or an activity bus. Caring for family or working a job counts too. Start a simple list of what you do.",
    "why": "Activities help you find what you like, make friends, and build skills that colleges and employers notice.",
    "category": "activities_summer",
    "pathway": "all",
    "sources": [
      "https://www.skillsusa.org/",
      "https://hosa.org/about-hosa/",
      "https://www.ffa.org/"
    ]
  },
  {
    "id": "g9-check-grades-weekly",
    "grade": 9,
    "months": [
      9,
      11,
      1,
      5
    ],
    "title": "Check your grades online every week",
    "detail": "Pick one day a week to check grades online (a phone or library computer works). If a grade slips, talk to your teacher that week and ask about tutoring. Try to come every day; tell your counselor if that's hard. After each semester, ask if you passed every class. If not, ask about credit recovery (redoing a class).",
    "why": "9th-grade grades count in your GPA (your overall grade average). Missing a credit happens, and it's much easier to fix when you catch it early.",
    "category": "habits",
    "pathway": "all",
    "sources": [
      "https://bigfuture.collegeboard.org/help-center/what-year-high-school-do-colleges-look-most"
    ]
  },
  {
    "id": "g9-sketch-four-year-plan",
    "grade": 9,
    "months": [
      10,
      11
    ],
    "title": "Sketch your four-year class plan",
    "detail": "Ask your counselor for your graduation requirements (they differ by state) and list your classes for each year. Leave room for CTE classes or a world language. College sport dreams? NCAA Division I needs 16 approved classes, 10 done before 12th grade (7 in English, math, or science). See your school's list at ncaa.org.",
    "why": "A plan helps you avoid 12th-grade surprises and keeps college and career-training doors open. NCAA Division I also needs at least a 2.3 GPA in its approved classes.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://www.ncaa.org/eligibility-center/initial-eligibility-requirements/division-i/",
      "https://www.ncaa.org/eligibility-center/resources-for-high-schools/",
      "https://web3.ncaa.org/hsportal/exec/hsAction?hsActionSubmit=searchHighSchool"
    ]
  },
  {
    "id": "g9-take-psat-8-9",
    "grade": 9,
    "months": [
      10,
      3,
      4
    ],
    "title": "Take the 9th-grade PSAT 8/9 if your school offers it",
    "detail": "Ask if and when your school gives the PSAT 8/9 (usually October or March-April). You take it in Bluebook, a testing app, often on a school device. No studying needed; scores don't go to colleges. Sharing your phone or email that day is optional and brings college messages. Can't pay a fee? Tell your counselor.",
    "why": "It's a low-pressure skills check. Your score report shows which reading and math skills to practice for free with Official SAT Prep on Khan Academy.",
    "category": "testing",
    "pathway": "all",
    "sources": [
      "https://satsuite.collegeboard.org/sat/dates-deadlines",
      "https://satsuite.collegeboard.org/media/pdf/psat-8-9-student-guide.pdf",
      "https://satsuite.collegeboard.org/sat-suite-benefits-students-parents/faq/psat-8-9",
      "https://satsuite.collegeboard.org/help-center/is-psat-8-9-free",
      "https://satsuite.collegeboard.org/practice"
    ]
  },
  {
    "id": "g9-talk-costs-with-family",
    "grade": 9,
    "months": [
      12,
      1
    ],
    "title": "Look at paying for school with your family",
    "detail": "Over winter break, try the Federal Student Aid Estimator at studentaid.gov with family (Spanish: studentaid.gov/es). It's for next year's students, so it's a ballpark. Pell Grants usually don't need to be repaid and help at colleges, career schools, and some short job programs. Not a U.S. citizen? Ask about state aid.",
    "why": "Seeing that help exists makes college or training feel possible. Some states even have scholarships you can sign up for in middle or early high school.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://studentaid.gov/aid-estimator/",
      "https://studentaid.gov/es/resources",
      "https://studentaid.gov/understand-aid/types/grants/pell",
      "https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-07-01/eligible-workforce-programs-state-workforce-pell-certification-form-available",
      "https://studentaid.gov/understand-aid/eligibility/requirements/non-us-citizens",
      "https://okpromise.org/"
    ]
  },
  {
    "id": "g9-see-college-course-requirements",
    "grade": 9,
    "months": [
      12
    ],
    "title": "See which classes four-year colleges want",
    "detail": "See which classes a public university in your state wants: search its name plus \"first-year requirements\" or ask your counselor. Some want more than you need to graduate. For example, the University of California asks for 15 yearlong college-prep classes, including 2 years of the same world language.",
    "why": "Checking before sign-ups lets you start a world language or the right math class on time, so you don't have to scramble later.",
    "category": "college_search",
    "pathway": "degree",
    "sources": [
      "https://admission.universityofcalifornia.edu/admission-requirements/first-year-requirements/subject-requirement-a-g.html"
    ]
  },
  {
    "id": "g9-see-training-program-requirements",
    "grade": 9,
    "months": [
      12
    ],
    "title": "See which classes training programs want",
    "detail": "Pick one career that needs training, like electrician. Look up a program near you on apprenticeship.gov or a community college site and write down what it asks for. Many electrical apprenticeships want you to be 18, have a diploma or GED, pass a year of algebra, and pass a test. Ask which CTE classes here lead there.",
    "why": "Like colleges, training programs have class rules. Knowing them before sign-ups helps you pick the right math and CTE classes.",
    "category": "career_exploration",
    "pathway": "training",
    "sources": [
      "https://www.electricaltrainingalliance.org/training/apprenticeshipTraining",
      "https://www.apprenticeship.gov/apprenticeship-job-finder",
      "https://www.apprenticeship.gov/sites/default/files/apprenticeship-requirements-reference-guide.pdf"
    ]
  },
  {
    "id": "g9-use-home-language-strength",
    "grade": 9,
    "months": [
      1,
      2
    ],
    "title": "Use your home language as a strength",
    "detail": "If you speak Spanish or another language at home, that's a real skill. Ask your counselor: Is there a class for heritage speakers? Can I test to earn world language credit? Does our school or state give the Seal of Biliteracy, an award for being strong in two languages by graduation? Plan your classes to earn it.",
    "why": "Being strong in two languages is a skill colleges and employers notice, and language credit you earn now can free up room for other classes.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://sealofbiliteracy.org/"
    ]
  },
  {
    "id": "g9-pick-10th-grade-classes",
    "grade": 9,
    "months": [
      2,
      3
    ],
    "title": "Pick your 10th-grade classes",
    "detail": "When sign-ups open, bring your four-year plan. Pick a class that's a good challenge, like honors or AP (college-level). Ask about CTE (career and technical) classes, like health or IT, and if a career-tech center near you takes applications. Ask when you can start dual enrollment (college classes for credit).",
    "why": "The classes you pick now open doors to harder classes, career programs, and college credit later.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://ies.ed.gov/ncee/wwc/EvidenceSnapshot/671"
    ]
  },
  {
    "id": "g9-line-up-summer-plan",
    "grade": 9,
    "months": [
      3,
      4,
      5
    ],
    "title": "Line up a free summer plan",
    "detail": "Ask your counselor, library, and community college about free summer programs; apply early. Ask if your city has paid summer jobs for teens. At 14-15, federal rules allow up to 8 hours a day and 40 a week in summer, 7 a.m. to 9 p.m., in certain jobs only. Your state may need a work permit. Caring for family counts too.",
    "why": "A summer program or job builds skills and experience, and applying early gives you more choices.",
    "category": "activities_summer",
    "pathway": "all",
    "sources": [
      "https://www.dol.gov/agencies/whd/youthrules/young-workers/non-ag-14-15"
    ]
  },
  {
    "id": "g9-explore-schools-near-you",
    "grade": 9,
    "months": [
      6,
      7
    ],
    "title": "Explore colleges and training programs near you",
    "detail": "Use the free College Scorecard (collegescorecard.ed.gov) to find schools in your state with certificates, associate degrees, or bachelor's degrees. Compare cost and graduation rates. For apprenticeships, try the Apprenticeship Finder on apprenticeship.gov. Visit a campus if you can, or take an online tour.",
    "why": "Seeing real schools and programs nearby helps you picture your next step, whichever path you choose.",
    "category": "college_search",
    "pathway": "all",
    "sources": [
      "https://collegescorecard.ed.gov/",
      "https://collegescorecard.ed.gov/search/",
      "https://www.apprenticeship.gov/apprenticeship-job-finder"
    ]
  },
  {
    "id": "g10-check-credits-with-counselor",
    "grade": 10,
    "months": [
      8
    ],
    "title": "Check your credits with your counselor",
    "detail": "Ask your counselor for your transcript (your list of classes and grades) and graduation plan. Did you pass every 9th-grade class you need? If not, ask how to make it up. Ask about any state tests you must pass, too; rules differ by state. Can't get a meeting soon? Check your online grade portal or ask the front office.",
    "why": "Finding a missing credit early gives you time to fix it, so you stay on track to graduate with every option open.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://www.ecs.org/50-state-comparison-high-school-graduation-requirements-2023/"
    ]
  },
  {
    "id": "g10-ask-about-october-psat",
    "grade": 10,
    "months": [
      8,
      9
    ],
    "title": "Ask if you can take the PSAT in October",
    "detail": "Some schools let 10th graders take the PSAT/NMSQT, a practice SAT, in October. You can only sign up through your school, so ask your counselor or a teacher before October, and ask if there's a fee. In 10th grade it's just practice: National Merit scholarships usually count only the 11th-grade score.",
    "why": "A practice run shows you what the SAT feels like and which skills to work on, with no pressure.",
    "category": "testing",
    "pathway": "all",
    "sources": [
      "https://bigfuture.collegeboard.org/plan-for-college/stand-out-in-high-school/faq-psat-nmsqt",
      "https://satsuite.collegeboard.org/sat/dates-deadlines",
      "https://satsuite.collegeboard.org/help-center/how-psat-nmsqt-different-psat-10-and-psat-8-9",
      "https://satsuite.collegeboard.org/help-center/will-11th-grade-students-taking-psatnmsqt-still-be-eligible-fee-waivers"
    ]
  },
  {
    "id": "g10-join-a-club-or-career-group",
    "grade": 10,
    "months": [
      9,
      10
    ],
    "title": "Join one club, team, or career group",
    "detail": "Try one activity this fall: a club, sport, music, or a career group like HOSA (health), FFA (agriculture), SkillsUSA (trades and tech), or FBLA or DECA (business). Ask a teacher about dues, a late bus, or help if money is tight. If you work or care for family after school, that counts too, so write it down.",
    "why": "Activities help you find what you enjoy and show colleges, training programs, and employers what you care about.",
    "category": "activities_summer",
    "pathway": "all",
    "sources": [
      "https://files.eric.ed.gov/fulltext/ED678588.pdf"
    ]
  },
  {
    "id": "g10-sign-up-for-ap-exams",
    "grade": 10,
    "months": [
      9,
      10
    ],
    "title": "Sign up for your AP exam on time",
    "detail": "In an AP class? Ask your AP teacher how and when to sign up for the May exam. Your school's deadline may be in September or October, before the College Board's mid-November cutoff. In 2027, exams cost $99 each; ask about the $37 fee reduction if money is tight. Late orders and exams you skip can cost $40 extra.",
    "why": "A good AP score can earn college credit or let you skip an intro class at many colleges. Each college sets its own rules.",
    "category": "testing",
    "pathway": "degree",
    "sources": [
      "https://apstudents.collegeboard.org/exam-policies-guidelines/exam-fees",
      "https://apcentral.collegeboard.org/about-ap/school-year-timeline"
    ]
  },
  {
    "id": "g10-take-career-interest-quiz",
    "grade": 10,
    "months": [
      10,
      11
    ],
    "title": "Retake the Interests quiz for high school",
    "detail": "Interests change as you grow. On your Home page, open Interests and take the quiz again. You can retake it 90 days after you last took it. Then pick 2 or 3 careers from your matches and check the education or training each needs. Want it in Spanish? Try miproximopaso.org.",
    "why": "Knowing if a job needs a degree, an apprenticeship, or a certificate helps you pick classes and plans that fit.",
    "category": "career_exploration",
    "pathway": "all",
    "sources": [
      "https://www.miproximopaso.org/"
    ]
  },
  {
    "id": "g10-get-help-before-finals",
    "grade": 10,
    "months": [
      11,
      12,
      4,
      5
    ],
    "title": "Get help before finals, not after",
    "detail": "Each fall and spring, check your grades online or on your progress report. If a class is slipping, ask that teacher when you can get help: before school, at lunch, or after. Practice free on Khan Academy. In spring, if you might fail a class, ask your counselor about summer school or other ways to make up the credit.",
    "why": "Asking for help is a smart move. Fixing a grade before the semester ends is much easier than retaking a class later.",
    "category": "habits",
    "pathway": "all",
    "sources": [
      "https://www.khanacademy.org/about"
    ]
  },
  {
    "id": "g10-apply-career-tech-program",
    "grade": 10,
    "months": [
      11,
      12,
      1
    ],
    "title": "Apply to a career-tech program for 11th grade",
    "detail": "Many districts have career-tech (CTE) programs or career centers in fields like health care, computers, or heating and air conditioning (HVAC). Deadlines vary, and some are in fall, so ask a CTE teacher or counselor now about deadlines, open houses, and buses. No center nearby? Ask about CTE classes at your school.",
    "why": "These programs build real job skills, and some lead to a certificate employers trust or college credit, before you graduate.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://octae.ed.gov/cte/initiatives/programs-of-study",
      "https://files.eric.ed.gov/fulltext/ED678588.pdf",
      "https://cte.ed.gov/"
    ]
  },
  {
    "id": "g10-learn-how-financial-aid-works",
    "grade": 10,
    "months": [
      12,
      1
    ],
    "title": "Learn how paying for school works",
    "detail": "With a family member, read the Types of Aid page on StudentAid.gov (also in Spanish). Grants and scholarships usually don't have to be paid back; loans do. Aid can help at colleges, many career schools, and now some short job-training programs. In 12th grade, you'll fill out a free form called the FAFSA to ask for aid.",
    "why": "Knowing that help exists for both college and training lets your family plan without guessing at the price.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://studentaid.gov/understand-aid/types",
      "https://studentaid.gov/understand-aid/types/grants",
      "https://studentaid.gov/es/resources/prepare-for-college/parents",
      "https://studentaid.gov/h/apply-for-aid/fafsa",
      "https://www.federalregister.gov/documents/2026/05/19/2026-10013/accountability-in-higher-education-and-access-through-demand-driven-workforce-pell-pell-grant"
    ]
  },
  {
    "id": "g10-pick-11th-grade-classes",
    "grade": 10,
    "months": [
      1,
      2,
      3
    ],
    "title": "Pick your 11th-grade classes",
    "detail": "Sign-up is often in winter or spring. Ask a teacher or counselor: Do my classes meet our state's 4-year college rules? They can ask for more than graduation does, like Algebra 2 or two years of one language. Also ask which honors, AP, dual enrollment (college classes in high school), or career-tech classes fit you.",
    "why": "11th-grade classes shape your options, and dual enrollment lets you earn real college credit while still in high school.",
    "category": "academics",
    "pathway": "all",
    "sources": [
      "https://admission.universityofcalifornia.edu/admission-requirements/first-year-requirements/subject-requirement-a-g.html",
      "https://ies.ed.gov/ncee/wwc/EvidenceSnapshot/671",
      "https://bigfuture.collegeboard.org/plan-for-college/stand-out-in-high-school/how-to-start-planning-for-college-in-10th-grade"
    ]
  },
  {
    "id": "g10-line-up-summer-plan",
    "grade": 10,
    "months": [
      2,
      3
    ],
    "title": "Line up a free summer program or a summer job",
    "detail": "Ask your counselor if Upward Bound serves your school. It's free for students from lower-income families or whose parents don't have a 4-year degree, and runs all year with a summer session. Some areas lost programs lately. Also ask your city or an American Job Center (a government job office) about youth summer jobs.",
    "why": "Summer is a great time to build skills, earn money, or try out college life. Ask early and have a backup plan. Helping your family counts too.",
    "category": "activities_summer",
    "pathway": "all",
    "sources": [
      "https://www.ecfr.gov/current/title-34/subtitle-B/chapter-VI/part-645",
      "https://coenet.org/news-impact/press-release/the-u-s-department-of-education-releases-initial-fy-2026-talent-search-and-eoc-awards-preserving-hundreds-of-trio-programs-but-leaving-communities-behind/",
      "https://www.careeronestop.org/LocalHelp/AmericanJobCenters/find-american-job-centers.aspx"
    ]
  },
  {
    "id": "g10-take-psat-10-or-preact",
    "grade": 10,
    "months": [
      3,
      4
    ],
    "title": "Take the PSAT 10 or PreACT this spring",
    "detail": "Many schools give the PSAT 10 in March or April; some give ACT's PreACT instead. Took the PSAT in October? Ask your counselor if you need another test. Ask about fees too: many schools don't charge, but there are no PSAT 10 fee waivers. Then practice 2 skills from your score report on Khan Academy's free SAT prep.",
    "why": "It's a low-pressure practice test that shows your strengths in reading and math, skills that help in college and job training alike.",
    "category": "testing",
    "pathway": "all",
    "sources": [
      "https://bigfuture.collegeboard.org/plan-for-college/stand-out-in-high-school/your-guide-psat-10",
      "https://satsuite.collegeboard.org/sat/dates-deadlines",
      "https://www.act.org/content/act/en/products-and-services/preact.html",
      "https://satsuite.collegeboard.org/practice",
      "https://satsuite.collegeboard.org/help-center/how-psat-nmsqt-different-psat-10-and-psat-8-9"
    ]
  },
  {
    "id": "g10-check-state-scholarship-rules",
    "grade": 10,
    "months": [
      4,
      5
    ],
    "title": "See if your state has a scholarship to earn now",
    "detail": "Some states pay for college or job training if you take certain classes, keep a certain GPA, or sign up early in high school. Find your state's college aid office on the list at nassgap.org, see what it offers, and write down the rules. Your counselor can help you check.",
    "why": "Some state money depends on what you do in high school. Knowing the rules now means you won't miss out.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://www.nassgap.org/advocacy-news-history/links-and-resources/",
      "https://studentaid.gov/understand-aid/types"
    ]
  },
  {
    "id": "g10-explore-apprenticeships",
    "grade": 10,
    "months": [
      6,
      7
    ],
    "title": "Explore apprenticeships near you",
    "detail": "Search Apprenticeship.gov for careers you like. Apprentices get paid while they learn on the job and in class. Each program sets its own rules, like a minimum age (at least 16 under federal rules) or a diploma, so note what they ask for. In August, ask your counselor if your school has a youth apprenticeship.",
    "why": "Apprenticeships are a respected path to a skilled career, and you get paid while you train.",
    "category": "career_exploration",
    "pathway": "training",
    "sources": [
      "https://www.apprenticeship.gov/career-seekers/new-to-the-workforce",
      "https://www.apprenticeship.gov/help/what-youth-apprenticeship",
      "https://www.apprenticeship.gov/educators/apprenticeship-for-young-people",
      "https://www.ecfr.gov/current/title-29/subtitle-A/part-29/section-29.5"
    ]
  },
  {
    "id": "g10-compare-schools-on-scorecard",
    "grade": 10,
    "months": [
      6,
      7
    ],
    "title": "Compare a few schools on College Scorecard",
    "detail": "On College Scorecard, look up a community college, a trade or career school, and a 4-year college near you. Compare graduation rate, what graduates earn, and Average Annual Cost (the average price after grants). A missing number doesn't mean a school is bad; ask the school. If you can, visit one or take a virtual tour.",
    "why": "Seeing real numbers side by side helps you think about value, not just a school's name or sticker price.",
    "category": "college_search",
    "pathway": "all",
    "sources": [
      "https://collegescorecard.ed.gov/",
      "https://collegescorecard.ed.gov/data/glossary/"
    ]
  },
  {
    "id": "g11-meet-your-counselor",
    "grade": 11,
    "months": [
      8,
      9
    ],
    "title": "Meet your counselor and ask about free help",
    "detail": "Ask your counselor: Am I on track to graduate? How do I sign up for AP exams (tests that can earn college credit)? Schools usually order them by mid-November; ask about fee help. Is our school served by a free program like Upward Bound or Talent Search? If not, what other free help is nearby?",
    "why": "Checking in early keeps you on track to graduate, and free programs near you can help with tutoring and plans for college or training.",
    "category": "habits",
    "pathway": "all",
    "sources": [
      "https://www.ed.gov/grants-and-programs/grants-higher-education/federal-trio-programs/upward-bound-program-84047a",
      "https://www.ed.gov/grants-and-programs/grants-higher-education/federal-trio-programs/talent-search-program-84044",
      "https://apstudents.collegeboard.org/exam-policies-guidelines/exam-fees"
    ]
  },
  {
    "id": "g11-take-psat-nmsqt",
    "grade": 11,
    "months": [
      9,
      10,
      11
    ],
    "title": "Take the PSAT (practice SAT) this fall",
    "detail": "Ask your counselor or check your school website for the date of the PSAT/NMSQT, a practice SAT (usually in October). In 11th grade, it's how you enter the National Merit Scholarship Program. If cost is a problem, ask. When scores come out, practice what you missed free on College Board's My Practice or Khan Academy.",
    "why": "It's low-pressure practice for the SAT, shows you exactly what to study, and can open the door to scholarships.",
    "category": "testing",
    "pathway": "degree",
    "sources": [
      "https://satsuite.collegeboard.org/sat/dates-deadlines",
      "https://satsuite.collegeboard.org/in-school-assessments",
      "https://satsuite.collegeboard.org/media/pdf/psat-nmsqt-student-guide.pdf",
      "https://satsuite.collegeboard.org/practice/khan-academy"
    ]
  },
  {
    "id": "g11-go-to-college-fair",
    "grade": 11,
    "months": [
      9,
      10,
      11
    ],
    "title": "Go to a free college fair and start a list",
    "detail": "National College Fairs are free, in some big cities and online. Ask colleges: What would a family like mine really pay? Then list 5 to 8 colleges, with one near home and some where your grades are above most students'. Try each one's Net Price Calculator (links at collegecost.ed.gov/net-price).",
    "why": "The listed price isn't always what you'd pay after grants, so checking early helps you find good-fit colleges your family can afford.",
    "category": "college_search",
    "pathway": "degree",
    "sources": [
      "https://www.nacacattend.org/fairs",
      "https://collegecost.ed.gov/net-price"
    ]
  },
  {
    "id": "g11-research-three-careers",
    "grade": 11,
    "months": [
      10
    ],
    "title": "Look up 3 careers you're curious about",
    "detail": "Go to bls.gov/ooh, the free Occupational Outlook Handbook, and look up 3 careers. Write down the pay and whether jobs are growing. Then open the \"How to Become One\" tab to see if the job needs a 4-year degree, a 2-year degree, a certificate or an apprenticeship. If you can, ask someone in that job what they like.",
    "why": "Knowing what training a career needs helps you choose your path after high school: college, training, or both.",
    "category": "career_exploration",
    "pathway": "all",
    "sources": [
      "https://www.bls.gov/ooh/",
      "https://www.bls.gov/ooh/construction-and-extraction/electricians.htm"
    ]
  },
  {
    "id": "g11-research-apprenticeships",
    "grade": 11,
    "months": [
      11,
      12,
      1
    ],
    "title": "Find apprenticeships and how to get in",
    "detail": "Search apprenticeship.gov by career and ZIP code for paid apprenticeships near you. Pick one and write down: How old must I be? (The law says at least 16, but programs can ask for more.) Do I need a diploma or GED? Is there a math or reading test? Do I need a driver's license? When do you take applications?",
    "why": "Apprenticeships pay you while you learn a skilled job. Knowing the rules now gives you time to get ready, like taking another math class or practicing for a test.",
    "category": "career_exploration",
    "pathway": "training",
    "sources": [
      "https://www.apprenticeship.gov/apprenticeship-job-finder",
      "https://www.apprenticeship.gov/sites/default/files/apprenticeship-requirements-reference-guide.pdf",
      "https://www.apprenticeship.gov/educators/apprenticeship-for-young-people",
      "https://www.bls.gov/ooh/construction-and-extraction/electricians.htm"
    ]
  },
  {
    "id": "g11-plan-spring-sat-act",
    "grade": 11,
    "months": [
      1,
      2
    ],
    "title": "Plan your spring SAT or ACT (free if you qualify)",
    "detail": "First, ask if your school gives the SAT or ACT free on a school day. If not, and your family's income is low (like getting free or reduced-price lunch), fee waivers give you 2 free SATs and up to 2 free ACTs. Ask your counselor, or request an SAT waiver online from College Board. Sign-ups close weeks before test day.",
    "why": "Some colleges and scholarships ask for scores. Fee waivers also give free score reports and can let you apply to some colleges for free as a senior.",
    "category": "testing",
    "pathway": "degree",
    "sources": [
      "https://satsuite.collegeboard.org/sat/registration/fee-waivers",
      "https://satsuite.collegeboard.org/sat/registration/fee-waivers/fee-waiver-eligibility",
      "https://satsuite.collegeboard.org/sat/registration/fee-waivers/fee-waiver-benefits",
      "https://www.act.org/content/act/en/products-and-services/the-act/registration/fees/fee-waivers.html",
      "https://satsuite.collegeboard.org/sat/dates-deadlines",
      "https://www.act.org/content/act/en/products-and-services/the-act/registration/test-dates.html",
      "https://satsuite.collegeboard.org/in-school-assessments"
    ]
  },
  {
    "id": "g11-apply-questbridge-prep",
    "grade": 11,
    "months": [
      1,
      2,
      3
    ],
    "title": "Apply to QuestBridge College Prep Scholars",
    "detail": "If you earn mostly A's in your hardest classes and your family earns under about $65,000 a year (for a family of 4), try this free program for juniors. You'll need a teacher reference, your transcript, some writing and your family's tax forms, so ask a teacher early. Check questbridge.org in January for the deadline.",
    "why": "It's free to apply and can lead to summer program scholarships and college visits. Even if you aren't picked, you'll get a head start on senior-year applications.",
    "category": "applications",
    "pathway": "degree",
    "sources": [
      "https://www.questbridge.org/apply-to-college/programs/college-prep-scholars-program",
      "https://www.questbridge.org/apply-to-college/programs/college-prep-scholars-program/apply"
    ]
  },
  {
    "id": "g11-choose-senior-classes",
    "grade": 11,
    "months": [
      2,
      3
    ],
    "title": "Choose your senior-year classes with a plan",
    "detail": "Check what you still need to graduate and what your top colleges or programs want. Try to keep taking math. Ask about AP, dual enrollment (college classes in high school; ask about cost), or CTE (career and technical) classes that end in an industry certification, a credential employers want. Rules vary by state.",
    "why": "Colleges and programs look at your senior classes, and the right ones can earn you college credit or a job credential early.",
    "category": "academics",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g11-summer-job-or-program",
    "grade": 11,
    "months": [
      3,
      4
    ],
    "title": "Line up a summer job, program or volunteer spot",
    "detail": "Some summer programs and jobs have spring deadlines, so look now. Pick one: a paid job, a pre-apprenticeship (it gets you ready for an apprenticeship; some start at 16), a free summer program at a college, or volunteering. Ask your counselor or an American Job Center (a government job office). Write down what you do.",
    "why": "Real experience helps you test a career, build skills, and show colleges or employers what you can do.",
    "category": "activities_summer",
    "pathway": "all",
    "sources": [
      "https://www.apprenticeship.gov/employers/explore-pre-apprenticeship",
      "https://www.apprenticeship.gov/educators/apprenticeship-for-young-people",
      "https://www.careeronestop.org/LocalHelp/AmericanJobCenters/find-american-job-centers.aspx"
    ]
  },
  {
    "id": "g11-estimate-financial-aid",
    "grade": 11,
    "months": [
      4,
      5
    ],
    "title": "Estimate your financial aid with your family",
    "detail": "With a parent or trusted adult, try the Federal Student Aid Estimator at studentaid.gov/aid-estimator. It's free, in English or Spanish, needs no account and applies for nothing. Aid helps with training too: since July 2026, Pell Grants (free money) can cover some short job programs, but only approved ones, so ask.",
    "why": "It's only a rough guess (the real number comes after you file the FAFSA), but it can make college or training feel possible and helps your family plan.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://studentaid.gov/aid-estimator/",
      "https://financialaidtoolkit.ed.gov/tk/learn/fafsa.jsp",
      "https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-07-01/eligible-workforce-programs-state-workforce-pell-certification-form-available",
      "https://fsapartners.ed.gov/sites/default/files/attachments/2026-03/Pell%20Eligibility%20for%20Workforce%20Programs.pdf"
    ]
  },
  {
    "id": "g11-ask-for-recommendations",
    "grade": 11,
    "months": [
      4,
      5
    ],
    "title": "Line up people to recommend you",
    "detail": "Check if the colleges you like want teacher letters, and how many. Pick junior-year teachers who know you well and ask in person before school ends. Give them a short note about your goals, activities and a class moment you're proud of. For an apprenticeship or job, ask a teacher, coach or boss to be a reference.",
    "why": "Teachers write stronger letters when they have time and details, and they get very busy in the fall of senior year.",
    "category": "applications",
    "pathway": "all",
    "sources": []
  },
  {
    "id": "g11-check-out-training-programs",
    "grade": 11,
    "months": [
      5,
      6
    ],
    "title": "Check out training programs near you",
    "detail": "Use CareerOneStop's free Local Training Finder or Community College Finder to find certificate and 2-year degree programs near you. Call, email or visit one. Ask: How long does it take? What's the total cost? Can I use financial aid? How many graduates get jobs? Is there a test to get in, or a waitlist?",
    "why": "Knowing costs, schedules and waitlists now means you can apply on time and start right after graduation.",
    "category": "college_search",
    "pathway": "training",
    "sources": [
      "https://www.careeronestop.org/Toolkit/Training/find-local-training.aspx",
      "https://www.careeronestop.org/LocalHelp/CommunityServices/find-community-colleges.aspx"
    ]
  },
  {
    "id": "g11-draft-college-essay",
    "grade": 11,
    "months": [
      6,
      7
    ],
    "title": "Start drafting your college essay",
    "detail": "Many colleges use the Common App, one application for many schools. It resets each August 1; your account carries over. Pick an essay prompt on commonapp.org (recheck in August) and write a rough draft in a Google Doc. If a college you like has its own application, read its questions too. Ask a teacher to read it.",
    "why": "Writing a draft this summer gives you time to make it your own, so senior fall feels calmer.",
    "category": "applications",
    "pathway": "degree",
    "sources": [
      "https://appsupport.commonapp.org/applicantsupport/s/article/What-do-I-need-to-know-about-Account-Rollover"
    ]
  },
  {
    "id": "g11-get-ready-for-fafsa",
    "grade": 11,
    "months": [
      6,
      7
    ],
    "title": "Get ready for the FAFSA",
    "detail": "The FAFSA opens by Oct. 1 of senior year. This summer, you and a parent can each make a StudentAid.gov account, each with your own email and phone. A parent without a Social Security number can too. Find your family's tax forms. No tax return? You can still apply. If you have no SSN, ask your counselor about state aid.",
    "why": "The FAFSA is the free form for college and training aid. Having accounts ready lets you file soon after it opens, so you don't miss aid deadlines.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://studentaid.gov/h/apply-for-aid/fafsa",
      "https://studentaid.gov/resources/prepare-for-college/creating-your-account",
      "https://studentaid.gov/articles/key-facts-accounts/",
      "https://studentaid.gov/help-center/answers/article/create-an-fsa-id-dont-have-an-ssn",
      "https://studentaid.gov/articles/things-you-need-for-fafsa/",
      "https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-07-21/2027-28-fafsa-beta-testing-plan-updated-sept-23-2026",
      "https://www.csac.ca.gov/undocumented"
    ]
  },
  {
    "id": "g12-make-senior-year-plan",
    "grade": 12,
    "months": [
      8
    ],
    "title": "Make your senior-year plan with your counselor",
    "detail": "Ask your counselor: Am I on track to graduate? Hard to get a meeting? Email them or ask a teacher. Make one calendar with every deadline: applications, tests, FAFSA, and scholarships. In an AP class? Sign up for the May exam by your school's deadline (often mid-Nov.). List schools you like, with one you can afford.",
    "why": "Senior year moves fast. One calendar puts every date in one place, so nothing sneaks up on you.",
    "category": "college_search",
    "pathway": "all",
    "sources": [
      "https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/college-application-timeline-12th-grade",
      "https://apstudents.collegeboard.org/exam-policies-guidelines/exam-fees"
    ]
  },
  {
    "id": "g12-ask-for-recommendation-letters",
    "grade": 12,
    "months": [
      8,
      9
    ],
    "title": "Finish your essay and confirm your letters",
    "detail": "Finish the essay you drafted this summer, or start one now: tell one true story that shows who you are, like a job, a family role, or something you built. Ask a teacher to read it. Confirm the 1-2 teachers you asked in spring, or ask by late Sept. Give them your deadlines, activity list, and at least 10 school days.",
    "why": "Your essay and letters show colleges who you are beyond grades. Starting early means less stress in October.",
    "category": "applications",
    "pathway": "degree",
    "sources": [
      "https://www.commonapp.org/apply/essay-prompts",
      "https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/college-application-timeline-12th-grade"
    ]
  },
  {
    "id": "g12-decide-on-last-sat-act",
    "grade": 12,
    "months": [
      8
    ],
    "title": "Decide if you'll take the SAT or ACT once more",
    "detail": "Many colleges are test-optional (a score isn't required), so check each. To retest: SAT fall dates are in Sept., Oct., Nov., and Dec.; ACT in Sept., Oct., and Dec. Sign-up closes weeks before. Applying by Nov. 1? Test in Sept. or early Oct. so scores arrive in time. Money tight? Ask your counselor for a fee waiver.",
    "why": "Fall is your last chance to add a score before most deadlines, and a fee waiver can make it free.",
    "category": "testing",
    "pathway": "degree",
    "sources": [
      "https://satsuite.collegeboard.org/sat/dates-deadlines",
      "https://www.act.org/content/act/en/products-and-services/the-act/registration.html",
      "https://www.act.org/content/act/en/products-and-services/the-act/registration/test-dates.html",
      "https://satsuite.collegeboard.org/sat/registration/fee-waivers/fee-waiver-benefits",
      "https://www.act.org/content/act/en/products-and-services/the-act/registration/fees/fee-waivers.html",
      "https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/early-decision-and-early-action-calendar-faq"
    ]
  },
  {
    "id": "g12-file-the-fafsa",
    "grade": 12,
    "months": [
      9,
      10
    ],
    "title": "File your FAFSA as soon as you can",
    "detail": "It opens each fall. You and each parent on it need a StudentAid.gov account, even a parent with no SSN. A parent's immigration status won't change your eligibility. Each of you must agree to share tax info to get aid. Foster care, homeless, or no parent contact? You may file without them. Help: 1-800-433-3243.",
    "why": "The free FAFSA unlocks federal, state, and school aid for college and career school. Some aid runs out, so earlier is better.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://studentaid.gov/apply-for-aid/fafsa/filling-out",
      "https://studentaid.gov/articles/fafsa-for-parents/",
      "https://studentaid.gov/articles/key-facts-accounts/",
      "https://studentaid.gov/understand-aid/eligibility/requirements/non-us-citizens",
      "https://studentaid.gov/apply-for-aid/fafsa/filling-out/dependency",
      "https://studentaid.gov/apply-for-aid/fafsa/fafsa-deadlines",
      "https://www.usa.gov/agencies/federal-student-aid-information-center",
      "https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-07-21/2027-28-fafsa-beta-testing-plan-updated-sept-23-2026"
    ]
  },
  {
    "id": "g12-use-application-fee-waivers",
    "grade": 12,
    "months": [
      9
    ],
    "title": "Use fee waivers so applying costs less",
    "detail": "Get free or reduced-price lunch or an SAT/ACT waiver? You may apply free: ask in your Common App profile, or use a college's waiver or NACAC's form. Some colleges also want the CSS Profile aid form. It's free if family income is up to $100,000, you had an SAT waiver, or you're an orphan or ward of the court under 24.",
    "why": "Fees add up fast. A waiver means money is never the reason you skip a school you like.",
    "category": "applications",
    "pathway": "degree",
    "sources": [
      "https://appsupport.commonapp.org/applicantsupport/s/article/What-do-I-need-to-know-about-the-Common-App-fee-waiver",
      "https://www.nacacnet.org/student/fee-waivers/",
      "https://satsuite.collegeboard.org/sat/registration/fee-waivers/fee-waiver-benefits",
      "https://www.act.org/content/act/en/products-and-services/the-act/registration/fees/fee-waivers.html",
      "https://cssprofile.collegeboard.org/fee-waivers",
      "https://cssprofile.collegeboard.org/about"
    ]
  },
  {
    "id": "g12-submit-college-applications",
    "grade": 12,
    "months": [
      10,
      11,
      12,
      1
    ],
    "title": "Send in your college applications on time",
    "detail": "Early deadlines are usually in Oct. or Nov. Early decision is binding: if you get in with enough aid, you must go and can't compare offers. Others vary: some are in Nov. or Dec. (University of California: Nov. 30), many in Jan. or Feb. Ask your counselor to send your transcript. Aim to finish one by Thanksgiving.",
    "why": "Applying on time keeps all your choices open. Early action lets you hear back sooner without having to commit.",
    "category": "applications",
    "pathway": "degree",
    "sources": [
      "https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/early-decision-and-early-action-calendar-faq",
      "https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/facts-about-early-decision-and-early-action",
      "https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/when-to-apply-faq",
      "https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/college-application-timeline-12th-grade",
      "https://admission.universityofcalifornia.edu/how-to-apply/applying-as-a-first-year/"
    ]
  },
  {
    "id": "g12-check-state-aid-programs",
    "grade": 12,
    "months": [
      10,
      11
    ],
    "title": "Check your state's grants and free-college programs",
    "detail": "Your state may have grants, and some pay for community or technical college. Some need their own form, with deadlines as early as November. Find your state on StudentAid.gov's deadlines page or ask your counselor. Can't file the FAFSA because of your immigration status? Ask if your state has its own aid form.",
    "why": "State aid can lower your cost a lot, especially for community college and career training. Applying on time is how you get it.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://studentaid.gov/apply-for-aid/fafsa/fafsa-deadlines",
      "https://www.collegefortn.org/tnpromise/",
      "https://www.csac.ca.gov/undocumented"
    ]
  },
  {
    "id": "g12-explore-apprenticeships-training",
    "grade": 12,
    "months": [
      11,
      12
    ],
    "title": "Make a shortlist of apprenticeships and programs",
    "detail": "Search Apprenticeship.gov's Apprenticeship Finder and CareerOneStop's Find Training tool. Pick your top 3. For each, write down when it takes applications, what it asks for (age, diploma, tests), and the cost. An American Job Center, a government office that helps people find jobs and training, can help too.",
    "why": "Registered apprenticeships are paid jobs with classes, and you finish with a credential employers across the country know.",
    "category": "career_exploration",
    "pathway": "training",
    "sources": [
      "https://www.apprenticeship.gov/career-seekers",
      "https://www.apprenticeship.gov/apprenticeship-job-finder",
      "https://www.careeronestop.org/FindTraining/find-training.aspx",
      "https://www.careeronestop.org/LocalHelp/AmericanJobCenters/find-american-job-centers.aspx"
    ]
  },
  {
    "id": "g12-apply-for-scholarships",
    "grade": 12,
    "months": [
      12,
      1,
      2,
      3
    ],
    "title": "Apply for a few scholarships each month",
    "detail": "Ask your counselor for local scholarships from community groups and businesses. Search free tools like CareerOneStop's Scholarship Finder, which also lists awards for trade and training programs. Try 1-2 a month, and reuse and tweak your essays. Never pay to apply for a scholarship. That's a sign of a scam.",
    "why": "Scholarships are money you don't pay back, and they can fill gaps that grants don't cover.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://www.careeronestop.org/Toolkit/Training/find-scholarships.aspx",
      "https://consumer.ftc.gov/articles/how-avoid-scholarship-and-financial-aid-scams"
    ]
  },
  {
    "id": "g12-apply-community-college-training",
    "grade": 12,
    "months": [
      1,
      2
    ],
    "title": "Apply to community college or a training program",
    "detail": "Ask the community college or program: Is there open admission (anyone with a diploma or GED can enroll)? How do you choose my first math and English classes? Can I use aid here? Then apply and list it on your FAFSA. Workforce Pell, a new grant, may pay for some 8-15 week programs, but only approved ones, so ask.",
    "why": "Applying early leaves time to sort out classes, financial aid, and sign-up before your term starts.",
    "category": "applications",
    "pathway": "training",
    "sources": [
      "https://www.careeronestop.org/FindTraining/Types/college.aspx",
      "https://studentaid.gov/understand-aid/types/grants/pell",
      "https://educate.iowa.gov/higher-ed/financial-aid/workforce-pell",
      "https://www.federalregister.gov/documents/2026/05/19/2026-10013/accountability-in-higher-education-and-access-through-demand-driven-workforce-pell-pell-grant"
    ]
  },
  {
    "id": "g12-apply-to-apprenticeships",
    "grade": 12,
    "months": [
      2,
      3,
      4
    ],
    "title": "Apply to apprenticeships and prep for the test",
    "detail": "Apply to your top picks when their windows open. Some, like electrical programs, want you to be 18, have a diploma or GED, and pass an entry test. Ask each program how to practice. Line up 1-2 references, like a teacher, coach, or boss. Not accepted yet? Ask about a pre-apprenticeship program that helps you get ready.",
    "why": "Apprenticeships are paid jobs with training. Getting ready for the test and interview helps you stand out.",
    "category": "applications",
    "pathway": "training",
    "sources": [
      "https://www.electricaltrainingalliance.org/training/apprenticeshipTraining",
      "https://www.apprenticeship.gov/apprenticeship-job-finder",
      "https://www.apprenticeship.gov/employers/explore-pre-apprenticeship"
    ]
  },
  {
    "id": "g12-check-portals-compare-aid",
    "grade": 12,
    "months": [
      3,
      4
    ],
    "title": "Check your aid portals and compare offers",
    "detail": "Check each school's portal (your student website) weekly and send any papers it asks for. Picked for verification? The school is just checking your FAFSA; you did nothing wrong. Total cost minus grants and scholarships is your net price. Loans must be paid back. Income dropped? Ask the aid office to review your aid.",
    "why": "Schools can't finish your aid without your papers, and net price shows what you would really pay.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://studentaid.gov/articles/things-after-fafsa/",
      "https://studentaid.gov/articles/evaluating-financial-aid-offers/",
      "https://studentaid.gov/articles/4-ways-manage-federal-student-aid/"
    ]
  },
  {
    "id": "g12-commit-by-decision-day",
    "grade": 12,
    "months": [
      4,
      5
    ],
    "title": "Say yes to your school or program",
    "detail": "Most colleges want your answer by May 1. Can't pay the deposit? Ask the college to waive it; NACAC has a deposit waiver form. Tell your other schools no so others can have your spot. Training: confirm your start date and sign any forms. Waitlisted? Tell the college you still want to come. Finish your classes strong.",
    "why": "Saying yes on time holds your spot. Colleges see your final grades, so finishing strong protects your offer.",
    "category": "college_search",
    "pathway": "all",
    "sources": [
      "https://bigfuture.collegeboard.org/pay-for-college/get-help-paying-for-college/what-to-do-summer-before-college",
      "https://www.nacacnet.org/student/fee-waivers/",
      "https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/college-application-timeline-12th-grade",
      "https://counselors.collegeboard.org/college-application/senioritis"
    ]
  },
  {
    "id": "g12-sign-up-for-first-classes",
    "grade": 12,
    "months": [
      5,
      6
    ],
    "title": "Sign up for your first classes or start date",
    "detail": "Community college or training program? Go to orientation, meet an advisor, and sign up for classes early, before they fill. Ask about a payment plan if aid doesn't cover it all. Apprenticeship? Confirm your start date, what tools or boots you need, and how you'll get there. Save every email and phone number.",
    "why": "Summer steps are easy to miss. Finishing them early keeps your spot and gets you class times that fit your life.",
    "category": "applications",
    "pathway": "training",
    "sources": []
  },
  {
    "id": "g12-sign-up-selective-service",
    "grade": 12,
    "months": [
      5
    ],
    "title": "Young men: sign up for Selective Service at 18",
    "detail": "Almost all young men ages 18 through 25 in the U.S., including immigrants, must sign up with Selective Service. Once you turn 18, sign up at sss.gov. It takes a few minutes. It's needed for some job training (like at American Job Centers), most federal jobs, and state aid in some states. Questions? Ask your counselor.",
    "why": "Signing up takes a few minutes and keeps doors open to job training, federal jobs, and state aid.",
    "category": "financial_aid",
    "pathway": "all",
    "sources": [
      "https://www.sss.gov/register/who-needs-to-register/",
      "https://www.sss.gov/register/benefits-and-penalties/",
      "https://www.sss.gov/faq/"
    ]
  },
  {
    "id": "g12-finish-summer-to-do-list",
    "grade": 12,
    "months": [
      6,
      7
    ],
    "title": "Finish your summer to-do list before fall",
    "detail": "Check your new school's email and portal every week. Ask your high school to send your final transcript. Do orientation and forms. Check your first bill; you can lower or turn down loans. First federal loan? Do entrance counseling and sign the loan agreement. Stuck? Call the school. First-gen? Ask about TRIO tutoring.",
    "why": "Summer forms still count. Finishing them now, and knowing your real cost, means a smooth first day.",
    "category": "applications",
    "pathway": "all",
    "sources": [
      "https://bigfuture.collegeboard.org/pay-for-college/get-help-paying-for-college/what-to-do-summer-before-college",
      "https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/college-application-timeline-12th-grade",
      "https://studentaid.gov/complete-aid-process/accept-aid",
      "https://studentaid.gov/articles/financial-aid-dictionary/",
      "https://www.ed.gov/grants-and-programs/grants-higher-education/federal-trio-programs/student-support-services-program-84042a"
    ]
  }
];
