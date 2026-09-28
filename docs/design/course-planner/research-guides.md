# School data and course guides for the course planner (UT, TN, TX)

Research date: 2026-09-25. I downloaded every file linked below, checked that it returns HTTP 200, and parsed it locally unless a note says otherwise. The WebSearch budget for this session was already used up. So I found the course guides by starting from the district homepages and school `WEBSITE` values in the NCES CCD directory, and by following links on primary sites. None of these guides comes from a search engine or a third-party aggregator.

---

## Key findings

1. **School lists are solved and free.** NCES CCD covers public schools, including charters. The latest final file is 2024-25; a 2025-26 preliminary file came out on 2026-07-01. PSS covers private schools (latest is 2023-24, released September 2026). Both are public domain CSV files keyed by NCES IDs.
2. **Use the grades-offered flags, not `LEVEL`, to find high schools.** 40 of Utah's 199 open regular high schools start at grade 10, and 61 Utah schools serve grades 7–9. For many Utah students, grade 9 courses come from a different school's guide. Plano Senior High (TX) is grades 11–12.
3. **Course guides vary a lot.** I found about 16 real guides across the three states: 200-page generated PDFs, Crystal Reports exports, HTML catalogs that load more courses with JavaScript, Google Docs, Google Sheets master schedules, one-page lists per grade, stale guides from past years, and pages that just say "will be posted."
4. **Only some guides print state codes.** Georgetown ISD (TX) prints TEA course codes. Williamson County (TN) prints TDOE codes. The Utah guides I sampled print local course numbers only.
5. **Printed state codes can't be trusted as they are.** I checked 82 code–title pairs from Williamson County's 2026-27 guide against TDOE's 2026-27 list:
   - 53 are active codes.
   - 13 are retired.
   - 16 are no longer on the list. For example, AP courses moved to `G36Hxx`.
   - `G01H00` is printed as "Algebra I", but the state list says `G01H00` is Advanced Creative Writing. Algebra I is `G02H00`.
6. **All three states publish machine-readable course lists for 2026-27.**
   - TX: TEA course code table, `.xlsx`, 1,675 codes.
   - TN: TDOE catalog with a public API and CSV/Excel/JSON export, 2,640 rows including 611 retired.
   - UT: USBE core codes, `.xlsx`, 1,888 rows.

   None maps to a shared national standard, and the licenses differ. TEA's is restrictive.
7. **NCES SCED is a better cross-state backbone.** It's public domain with no fee: 5-digit subject codes, a rigor level (B/G/E/H/C/X), Carnegie credit, and separate codes for AP and IB. My recommendation: printed state code (validated) → SCED code + level → the app's generic course type.
8. **Honors is rarely a separate state code.** TX and TN honors or advanced sections share the regular course's code (for example Georgetown `ALG2` and `ALG2H` are both `03100600`, and Williamson County Algebra II and Algebra II Honors are both `G02H05`). Only Utah has separate "Extended/Honors" codes. So the level has to come from the guide's local label.
9. **Texas dual credit is a transcript flag, not a course code.** TEDS `DualCreditIndicator` is a Boolean on the transcript record. Tennessee does have separate Dual Enrollment and SDC codes. Utah has concurrent-enrollment ("CE") codes.
10. **The hardest extraction failures I observed:**
    - Text order that separates each course's details from its title (Georgetown).
    - One word per line in the extracted text (Williamson County).
    - Encrypted PDFs that forbid copying.
    - The wrong document uploaded, such as a registration packet or a master schedule.
    - Stale years.
    - Several local variants of one course.
    - Block-schedule credit rules.
    - Grade level shown only by cell color.
    - Staff names and PDF author metadata.

---

## 1. School directories

### 1.1 NCES Common Core of Data (CCD), public schools

**Files (checked 2026-09-25)**

| File | URL | Size / date | Notes |
|---|---|---|---|
| 2024-25 School Directory (final, v1a) | https://nces.ed.gov/ccd/Data/zip/ccd_sch_029_2425_w_1a_073025.zip | 13.35 MB zip, Last-Modified 2025-12-29; CSV 41 MB + SAS | 102,178 schools, 65 variables. "Access Control: Public; no access restrictions." Data as of 2025-07-30, released December 2025 (NCES 2026-005d). |
| 2024-25 Directory companion (layout, codes) | https://nces.ed.gov/ccd/xls/SY_2024-25_SCH_Directory_Companion_2026-005d.xlsx | 54 KB | Field definitions and value lists |
| 2025-26 Preliminary Directory (v0a) | https://nces.ed.gov/ccd/data/zip/ccd_sch_029_2526_w_0a_050626.zip | 12.7 MB, Last-Modified 2026-07-01 | Same 65 columns; covers UT, TN and TX (UT 1,123, TN 1,936, TX 9,770 records). Companion: https://nces.ed.gov/ccd/xls/SY_2025-26_School_Directory_Companion_2026-022.xlsx |
| 2024-25 School Characteristics | https://nces.ed.gov/ccd/Data/zip/ccd_sch_129_2425_w_1a_073025.zip | 5.6 MB | `SHARED_TIME`, `VIRTUAL`, `NSLP_STATUS` |
| 2024-25 Membership (enrollment), school / LEA | https://nces.ed.gov/ccd/Data/zip/ccd_sch_052_2425_l_1a_073025.zip / https://nces.ed.gov/ccd/Data/zip/ccd_lea_052_2425_l_1a_073025.zip | 212.7 MB / 68.5 MB zip (long format, 650 MB CSV for LEA) | Only needed for school size |
| EDGE geocodes (lat/long) | https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_2425.zip | 30.4 MB | Optional, for distance search |
| File finder (dynamic) | https://nces.ed.gov/ccd/files.asp | | The page loads its list from a JSON API, e.g. `https://nces.ed.gov/ccd/datatables/api/File/2/7/39/0/0/0` (nonfiscal / school / 2024-25) |

**Format.** Comma-separated CSV encoded as Latin-1 (read it as `latin-1`). Values are text labels ("Yes", "No", "Not reported"), not codes.

**Fields you need**

| Field | Meaning / values (from the companion file) |
|---|---|
| `NCESSCH` | 12-character NCES school ID (text; keep leading zeros). Example: `483510003969` = Plano Sr H S |
| `LEAID`, `LEA_NAME` | 7-character NCES district ID and district name |
| `ST_SCHID`, `ST_LEAID` | State IDs, e.g. `TX-043910-043910001` (the TEA campus number is the last part), `TN-00940-0017`, `UT-01-01704` |
| `SCH_NAME`, `LCITY`, `LSTATE`/`ST`, `LZIP`, `LSTREET1` | Name and physical address (`M*` fields are the mailing address) |
| `WEBSITE` | Often the district site rather than the school's, sometimes out of date. Blank for 31% of schools nationally; blank for 57 of 364 UT, 82 of 511 TN, and 667 of 2,602 TX schools offering grades 9–12 |
| `G_PK_OFFERED` … `G_12_OFFERED`, `G_13_OFFERED`, `G_UG_OFFERED`, `G_AE_OFFERED` | Yes / No / Not reported |
| `GSLO`, `GSHI` | Lowest and highest grade: `PK, KG, 01…13, UG, AE, M` (missing), `N` (not applicable) |
| `LEVEL` | Elementary / Middle / High / Secondary / Other / Prekindergarten / Ungraded / Adult Education / Not reported / Not applicable |
| `SCH_TYPE` | 1 Regular, 2 Special Education, 3 Career and Technical, 4 Alternative |
| `UPDATED_STATUS` | 1 Open, 2 Closed, 3 New, 4 Added, 5 Changed Boundary/Agency, 6 Inactive, 7 Future, 8 Reopened |
| `CHARTER_TEXT` | Yes / No / Not applicable |
| From file 129: `SHARED_TIME`, `VIRTUAL_TEXT` | Shared-time centers (for example CTE centers) and virtual status. Mostly "Missing" for Texas. |

**License.** NCES's "Permission to Replicate Information" says: "Unless stated otherwise, all information on the U.S. Department of Education's IES website at http://ies.ed.gov is in the public domain and may be reproduced, published, linked to, or otherwise used without IES' permission." (https://nces.ed.gov/help/privacy.asp). The companion file also says "Public; no access restrictions."

**How to filter (tested on the 2024-25 final file)**

- `ST in ('UT','TN','TX')`
- `UPDATED_STATUS in ('1','3','4','5','8')`. This drops Closed, Inactive and Future.
- **High school:** any of `G_9_OFFERED`…`G_12_OFFERED == 'Yes'`. **Middle school:** `G_7_OFFERED` or `G_8_OFFERED == 'Yes'`. Don't filter on `LEVEL`, because K–12 and 7–12 schools show up as "Other," "Secondary" or "Elementary."
- Probably keep `SCH_TYPE` 1 (Regular) and 4 (Alternative) as "home" schools. Treat 3 (CTE) and anything with `SHARED_TIME = Yes` as places where students take some courses, not as home schools.
- Store the CCD school year and release version with every school row.

| 2024-25, open-type statuses | UT | TN | TX |
|---|---|---|---|
| All records | 1,119 | 1,928 | 9,774 |
| Offering any grade 9–12 | 364 | 511 | 2,602 |
| Offering grade 7 or 8 | 374 | 671 | 2,710 |
| Offering grade 12 | 260 | 498 | 2,319 |
| 9–12 schools by type | Regular 303, Alternative 29, Special Education 23, CTE 9 | Regular 466, Alternative 24, CTE 14, Special Education 7 | Regular 1,822, Alternative 765, Special Education 15 |
| Charter (9–12) | 79 | 29 | 515 |

**Grade spans matter for planning.** Among open regular schools that include grade 12:
- **Utah:** 59 start at grade 9, **40 start at grade 10** (Herriman High and American Fork High are 10–12), and 43 start at grade 7. Another **61 Utah schools span grades 7–9** (junior highs).
- **Tennessee:** 315 of 453 start at grade 9.
- **Texas:** 1,181 of 1,719 start at grade 9.

Utah requires 24 credits earned in grades 9–12 (R277-700-6, https://schools.utah.gov/curr/graduationrequirements.php). So for many Utah students, grade 9 credit is earned at a junior high with its own course guide. CCD has no feeder-pattern data, so the app should ask for both the current school and the expected high school.

### 1.2 NCES Private School Universe Survey (PSS)

| File | URL | Notes |
|---|---|---|
| Data page | https://nces.ed.gov/surveys/pss/pssdata.asp | "Data from the 2025–26 PSS collection are being finalized and will be available in spring 2027." |
| 2023-24 public-use CSV | https://nces.ed.gov/surveys/pss/zip/pss2324_pu_csv.zip | 3.97 MB zip, Last-Modified 2026-09-04 → `pss2324_pu.csv`, 22,510 rows × 359 columns. SAS and SPSS versions are also on the page. |
| Codebook / layout / readme | https://nces.ed.gov/surveys/pss/pdf/codebook2023_24.pdf, https://nces.ed.gov/surveys/pss/pdf/layout2023_24.pdf, https://nces.ed.gov/surveys/pss/pdf/Readme2023_24.pdf | User manual NCES 2026-035: https://ies.ed.gov/nces/2026/09/nces-2026035-2023-24-private-school-universe-survey-pss-public-use-data-file-users-manual |
| Frame file | https://nces.ed.gov/surveys/pss/xls/2023-24_PSS_Frame_Data.csv | 57,265 rows with only `PPIN, ISR, OOS, INACTIVE` (status flags, no names) |
| Private school geocodes | https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PRIVATESCH_2324.zip | 6.5 MB |

**Fields**
- ID and location: `PPIN` (8-character permanent ID, e.g. `A1903589`), `PINST` (name), `PADDRS`/`PCITY`/`PSTABB`/`PZIP` (mailing address), `PL_ADD`/`PL_CIT`/`PL_STABB`/`PL_ZIP` (location; only 3,054 rows have it), `LATITUDE24`/`LONGITUDE24`, `ULOCALE24`.
- Grades: `LOGR2024`/`HIGR2024` (grade recodes 1–17, where 14 = grade 9 and 17 = grade 12). Grade-offered flags are 1 = Yes, 2 = No: `P245` = 7, `P255` = 8, `P265` = 9, `P275` = 10, `P285` = 11, `P295` = 12.
- School type: `LEVEL` (1 Elementary, 2 Secondary, 3 Combined), `TYPOLOGY` (9 categories: Catholic, other religious, nonsectarian), `RELIG`, `NUMSTUDS`.
- **There is no website field** and no NCES-style school ID.

**Gotchas**
- The public-use file **only includes schools that answered the survey** (readme: "The files only include the interviewed cases"). Some private schools are missing, so the school picker needs a "my school isn't listed" path.
- Addresses need checking. One Chattanooga, TN school has `PZIP` 34711 (a Florida ZIP code). Validate ZIP against state.
- The survey runs every two years.

**Counts (2023-24 respondents):**

| State | Schools | Offering any grade 7–12 | Offering any grade 9–12 | Offering grade 12 |
|---|---|---|---|---|
| UT | 140 | 103 | 78 | 65 |
| TN | 391 | 290 | 212 | 174 |
| TX | 1,330 | 799 | 503 | 455 |

**License:** the same NCES/IES public-domain statement as CCD.

---

## 2. Real published course guides (UT, TN, TX)

District size is 2024-25 enrollment from the CCD LEA membership file.

### Texas

| District / school (size) | URL | Format | How courses are listed | Prerequisites | Grade levels | Levels | Credits / term | State codes |
|---|---|---|---|---|---|---|---|---|
| **Katy ISD** (96,111; district-wide) | https://www.katyisd.org/fs/resource-manager/view/619d72fb-28d2-4589-a6ae-f9bc683da1fe → https://resources.finalsite.net/images/v1790284868/katyisdorg/jffndqjzd7fym0ctmb8d/Course_Catlog_2026-2027.pdf | 209-page PDF generated from HTML by xhtml2pdf; PDF title "Sequence Configration" | Front matter with graduation plans per cohort ("Class of 2025-2028" vs "Class of 2029 and thereafter"), then courses by subject: `0253 - Algebra 2 KAP` / `1.0 credits / Full year course / Grades: 9, 10, 11, 12` / `Tags: KAP` | `Prerequisite: Algebra 1 and Geometry`, `Corequisite: n/a`, plus prose ("With campus approval, Algebra 2 may be taken concurrently with Geometry in grades 10-12") | `Grades:` list | `Tags:` Advanced Placement (130), KAP (Katy's local advanced label, 71), Dual Credit (36), Career and Technical Education, Virtual, Summer, Junior High with HS Credit, Miller Career and Technology Center (a separate campus) | "1.0 credits / Full year course" | Local 4-digit codes plus suffix variants (`0261`, `0261VIR`, `0261VIRID`, `0261VIRS`); no TEA codes |
| **Northside ISD** (100,208) | https://www.nisd.net/schools/catalogs/hs → https://www.nisd.net/schools/catalogs/hs/descriptions (e.g. Math https://www.nisd.net/node/56066); MS catalog PDF https://www.nisd.net/sites/default/files/attachments/course-catalog-ms-en.pdf | HTML, one page per subject | `Algebra II (9-12) #2200`, `Algebra II M #2204`, `Advanced Algebra II (9) #2239` | `PR: Algebra I` | Grades in parentheses inside the title | "Advanced" prefix; magnet and CTE programs listed by campus | `SEM: 2 CR: 1` | Local numbers only |
| **Plano ISD** (46,612) | https://www.pisd.edu/students-families-a6/course-catalog/hs-catalog (CTE: https://www.pisd.edu/departments-66/career-and-technical-education/course-catalog) | Searchable HTML (Finalsite), with filters for AP, CTE, Dual Credit, Honors and Grade 9–12. The static HTML contains only the first 20 courses. | `Course ID: 952491 YR / Credit: 0 / Grade Placement: 11, 12`. Variants listed as separate courses: "Academic Literacy I", "… ALT", "… GM", "… RM" | Not in the list view | "Grade Placement" | Filter tags | "YR" plus credit | Local 6-digit IDs. The page says: "The searchable catalog is specific to students entering 9th grade prior to 2026-2027. Students entering 9th grade in 2026-2027 will refer to the catalogs that are coming soon." |
| **Georgetown ISD** (13,881; district-wide) | https://www.georgetownisd.org/about-gisd/policies-procedures/policies-procedures/course-guides-grading-graduation → https://resources.finalsite.net/images/v1769640103/georgetownisdorg/zc32kia7nlfybmiuhrff/26_27GISDCourseGuide.pdf. The 2025-26 guide had mid-year addenda, e.g. https://resources.finalsite.net/images/v1755290086/georgetownisdorg/dfuqxlbn1efjf060s7or/25_26HSCourseGuide8_12Addendum.pdf | 179-page PDF made with Crystal Reports | Each record: `Service ID` (TEA code), `Course Key` (local), title, `Prerequisite(s)`, `Recommended:`, description, course type and weight, `Counted in Rank GPA`, `Credit Type: State/Local`, `Credits: 1.00`, `Length: YR` | `Prerequisite(s): Algebra 1, LPAC Placement, Identified LEP`, `Recommended Prerequisite(s): Precalculus` | In the text | Course types Regular / Honors / Adv. Placement / Dual Credit / Innovative / Articulated / Local Credit; weights Core / Advanced / Modified; OnRamps and ACC dual credit | "Credits:1.00 / Length: YR" | **Yes, TEA codes** (e.g. `03100600` shared by `ALG2`, `ALG2H`, `ALG2C` and `ALG2DBC`; `A3100101` Calculus AB AP) |
| **Jim Ned CISD** (1,639) | http://schools.jimned.esc14.net/page/jnhs.cooley_course_offerings → e.g. http://schools.jimned.esc14.net/upload/page/1238/9th%20grade%20course%20offerings.pdf | One-page PDF per grade, made in Word (the 9th-grade file was last modified 2024-03-18) | A bare list: "English, P- AP English / Algebra 1, P-AP Geometry / Biology, P-AP Bio …" | None | Implied by which file it's in | "P-AP" (Pre-AP) | None | None |
| **Runge ISD** (162) | http://www.rungeisd.org/vnews/display.v/SEC/The%20Counselor%27s%20Corner%7CCourse%20Catalog → http://www.rungeisd.org/vimages/shared/vnews/stories/66a7ff7259e03/Final%20Runge%20Course%20Catalog%202024-2025.pdf | 35-page PDF, last edited with KamiHQ | `Algebra II/Algebra II Honors   Credit: 1   Grade 10-11` then `Prerequisite:` then a description | `Prerequisite: Algebra I, Geometry or concurrent enrollment` | "Grade 10-11" | A list of weighted courses; dual credit through Victoria College with college course numbers ("College Algebra (1314)") | "Credit: 1", "Credit: ½" | None. **Still the 2024-25 guide in September 2026**, and it cites the retired "Recommended and Distinguished Achievement Programs." |

### Tennessee

| District / school (size) | URL | Format | How courses are listed | Prerequisites | Grade levels | Levels | Credits / term | State codes |
|---|---|---|---|---|---|---|---|---|
| **Williamson County Schools** (41,593; district-wide) | https://docs.wcs.edu/pdf/schools/HS-Program-Planning-Guide-2627.pdf (MS: https://docs.wcs.edu/pdf/schools/MS-Course-Descriptions-2026-2027.pdf) | 88-page PDF printed from Chrome (modified 2026-08-18) | `G02H05 Algebra II – description … Grade Level: 9-12 Prerequisite: Algebra I Teacher Recommendation Needed: No Minimum Credit: 1.0 Maximum Credit: 1.0 NCAA Approved: Yes`, with `EPSO: Yes` on college-credit courses | Inline | "Grade Level: 10-12" | Honors listed as its own course but under the **same state code** (e.g. Algebra II Honors = `G02H05`). Local GPA rule: "This course shall be treated as an Honors, not an AP/IB course, for GPA calculation" (IB Math AI SL) | Minimum/Maximum Credit | **Yes, TDOE codes, but many are stale or wrong.** See section 3.2 for the validation results. |
| **Knox County Schools** (60,185): Farragut High | https://farraguths.knoxschools.org/student-family-resources/school-counseling/registration-2026-2027 → program of studies: https://docs.google.com/document/d/1UBeM1fBTaU1UDivzQd2i-tzuNoTQ1H5j/edit | A Word file stored in Google Drive; separate Google Docs per graduating class; Google Sheets for elective focus areas | `Algebra 2 / Link: Algebra 2 / Prerequisite: Alg 1, Geom / Course Description: … / Topics Covered In This Course:` | Abbreviated ("Alg 1, Geom") | Mostly absent | AP, Honors | Mostly absent | None |
| Knox County: West High | https://wesths.knoxschools.org/student-family-resources-west/school-counseling/course-registration → https://resources.finalsite.net/images/v1769472173/knoxschoolsorg/squv5fvs2fjam1oudot4/WHSPROGRAMOFSTUDIES26_27.pdf | 48-page PDF printed from macOS; the PDF has structural errors (the parser reports "Ignoring wrong pointing object"); words separated by tab characters | Prose paragraphs with the prerequisite in the text ("Prerequisites: Algebra 1 and Honors Geometry credit. A grade of…") | In prose | In prose | IB program, AP, "AP Niswonger" courses | In prose | None. The district itself posts a "Career Guide" only as an Adobe InDesign web viewer: https://indd.adobe.com/view/d9fb88e1-2c46-4d03-9bc0-629aefd08708 |
| **Johnson City Schools**: Science Hill High (7,818) | https://sciencehill.jcschools.org/programs/program-of-studies (per subject, e.g. /math) + PDF https://resources.finalsite.net/images/v1786119553/jcschoolsorg/jcschoolsorg/jcschoolsorg/b1w7jacaylxnukex4gga/ProgramofStudiesSY26-27.pdf (80 pages, Word) | HTML + PDF | `ALGEBRA 1B / One Semester / 1 credit / EOC: YES / Grade 9-10 / Prerequisite: Algebra 1A…` | Includes grade requirements ("A or B in Honors Algebra 1 … with teacher recommendation") | "Grade 9-11" | Honors, AP (AP Capstone), dual enrollment | **Block schedule:** "One Semester / 1 credit." Algebra 1A counts as a "Math Elective Credit." | None. The guide includes sequencing rules: "Any 9th grade student who has a goal of taking AP Calculus AB or BC must take Geometry and Algebra 2 by their sophomore year." |
| **Alcoa City Schools**: Alcoa High (2,270) | http://www.ahs.alcoaschools.net/apps/pages/index.jsp?uREC_ID=4075990&type=d&pREC_ID=2592786 → Google Doc https://docs.google.com/document/d/1YcQBuQvmoaIXiZgKuvRd2vtka6yTvPJCeqLDNv5UMGE/edit | Embedded Google Doc ("Academic Planning Guide 2026-2027") | Course sections plus "Recommended Course Sequences" tables by grade (flow arrows lose their structure when exported as text) | Per course | By grade column in the sequence tables | Local labels "ACP" and "CP"; "SDC" (statewide dual credit); DE; AP | 28 credits required (district total) | None |
| **Haywood County** (2,422) | https://haywoodschools.com/haywood-high-school/curriculum-guides/ | Page only says: "Haywood High School Curriculum Guides. Information will be posted in the near future." | | | | | | This is the case where the generic fallback is needed. |

### Utah

| District / school (size) | URL | Format | How courses are listed | Prerequisites | Grade levels | Levels | Credits / term | State codes |
|---|---|---|---|---|---|---|---|---|
| **Jordan District** (58,788): Herriman High (grades 10–12) | http://www.herrimanhigh.org/apps/pages/index.jsp?uREC_ID=2094942&type=d&pREC_ID=2140485 → catalog https://4.files.edl.io/daa1/02/03/26/214908-3e170d89-0e4b-4734-a1a7-9bef9fc054a6.pdf (63 pages); master schedule https://4.files.edl.io/152a/08/11/26/152344-99e50791-ee07-4c64-9335-85f8cce507ea.pdf | PDF with a text layer, but the metadata says it came off a Canon copier and has an unrelated title ("JATC Quick Facts - Google Sheets") | `SECONDARY MATHEMATICS 2 HONORS   NCAA Approved / Course # 53110 / … / Grade Level 10th / Credit: 1 Core Math / Prerequisite: Secondary Math 1H grade C or higher / Fees: See Class Disclosure` | Includes minimum grades | "Grade Level 10th - 12th" | Honors, AP, CE (concurrent enrollment with SLCC, SUU, WSU, USU and the University of Utah at "$5 per credit hour") | "Credits may be earned as 0.5 (one semester or 2 quarters) or as 1 full credit"; 27 credits required | Local 5-digit numbers only. The district "Secondary Registration Book" (https://planning.jordandistrict.org/wp-content/uploads/sites/22/2026-27-Secondary-Registration-Book-English.pdf, 59 pages) is an enrollment-forms packet, not a catalog, and is **encrypted with copying and text extraction not allowed** (AES-256; permission flags P = -1052). |
| **Salt Lake City SD** (19,049): Highland High | http://highland.slcschools.org/course-catalog; course request cards per grade, e.g. https://files.smartsites.parentsquare.com/9089/9th_course_card_2026.pdf | HTML catalog with expand/collapse sections | `Secondary Math II (1.0) / Course Number: 61212400 / Grade Level: 10, 11 / Length of Class: Full Year / Graduation Credit: 1.0 Mathematics / Location: …` | Mostly in the descriptions | "Grade Level: 9, 10" | Extended (Utah's honors label), AP, CE, IB (entry by application in 8th grade); some courses at another campus (CTC, West, East) | "1.0 = Full-Year Course, 0.5 = Semester Course"; some semester-long CE courses carry extra credit; 24 credits required | 8-digit **local** numbers. They are not USBE codes: Secondary Math II is `07080000100` in the USBE list. |
| **North Sanpete District** (2,706): North Sanpete High | http://www.nsh.nsanpete.org/ → "Course Catalog '26-27": https://docs.google.com/spreadsheets/d/e/2PACX-1vRJpJ0UOvSSpBvdfbh_wK73zIQGG68_GffOvkRPuD--XHpX0L_ErR9LwJtI7D_7mFHIBsZnaTsk9lMf/pubhtml?gid=0&single=true (CSV: `…/pub?gid=0&single=true&output=csv`) | Published Google Sheet | **A master schedule, not a catalog:** a teacher × period grid ("Hadley, A": Math 1, Math 1 - Honors, Physics…). A legend (Seniors/Juniors/Sophomores/Freshmen) shows grade by cell color, which the CSV loses. | None | Only by color | Honors, AP, English 1010 (CE), Snow College courses by interactive video | None | None. Contains staff names. |
| **South Summit District** (1,616): South Summit High | https://sshs.ssummit.org/academic-planning → graduation requirements https://wsos-cdn.s3.us-west-2.amazonaws.com/uploads/sites/201/Graduation-Requirements-and-Information.pdf; master schedule https://ecs-cluster-bucket-wsos-prod-c3.s3.us-west-2.amazonaws.com/uploads/sites/39/Master-Schedule.pdf | One-page requirements PDF + master schedule exported from Google Sheets | No course catalog, only the schedule grid | None | None | Honors diploma applications per subject | **32 credits** required (state minimum is 24) | None |
| Charters: NUAMES (1,126) and Winter Sports School (105) | http://www.nuames.org/main/nuames-district-course-catalog (HTML sections); https://docs.google.com/document/d/1krYqz94zO1pZy0aYqkUmXch9aWiGHVqS78SP9SKOdps/edit | HTML; Google Doc | | | | | | Not inspected in detail |
| Alpine (86,645), Davis, Box Elder (UT); Frisco and Dripping Springs ISD (TX); Rutherford County (TN) | Home pages | The Alpine home page returned a 3,036-byte bot "Client Challenge" page to a script. The other five returned pages of exactly the same size, so almost certainly the same challenge. | | | | | | Fetching automatically from the web won't work for every district. The product needs an "upload the PDF" path. |

### What the guides have in common
- **A code printed on a guide is usually a local code.** Only Georgetown (TX) and Williamson County (TN) printed state codes. Utah guides print local numbers of 5 or 8 digits.
- **Level labels are local:** KAP, Advanced, P-AP, Pre-AP, ACP/CP, Extended, Honors. College credit goes by many names: Dual Credit, Dual Enrollment, Concurrent Enrollment (CE), SDC, OnRamps. Which courses are weighted in GPA is local too (Runge publishes a list; Williamson County treats IB Math AI as honors).
- **Credit means different things.** Some examples: "1 credit" for one semester on a 4×4 block (Science Hill), 0.5 per semester (Utah), "SEM: 2 CR: 1" (Northside), "Credit: 0" (Plano Academic Decathlon), and Texas codes allowing ".5-1" units.
- **Graduation plans depend on the student's class year:** Katy (Class of 2025–2028 vs 2029+), Plano (entering 9th before or after 2026-27), Science Hill ("beginning with the class of 2027").

---

## 3. State course code lists as a shared course vocabulary

### 3.1 Texas: TEA course codes (formerly PEIMS C022 "Service ID")

- **Current list (2026-27):** https://tealprod.tea.state.tx.us/TWEDSAPI/34/0/0/References/CourseCodes (dated 07/01/2026). It links the Excel file https://www.texasstudentdatasystem.org/tsdsabout/tsds-upgrade-project/2026-2027-addendum-course-information.xlsx.
  - 1,675 codes.
  - Columns: Course Code, Course Title, Eligible for State HS Credit, Course Abbreviation, Units, CTE Course, Date Change. Section headers are mixed into the rows.
  - **760 all-numeric codes are stored as numbers and have lost their leading zero** (`3100600` should be `03100600`). Pad them to 8 characters.
- **Changes per year:** https://www.texasstudentdatasystem.org/tsdsabout/tsds-upgrade-project/2026-2027-addendum-cumulative-coursecodes-change-log.pdf. For example, innovative codes `N1302103` and `N1302129` were deleted and re-added as state codes `13021018` and `13021210`.
- **Older CSV format (TWEDS 2024.2.1):** `C022.csv` inside https://tealprod.tea.state.tx.us/TWEDS/103/0/0/0/CodeTable/DownloadAll, with columns Code, Translation, Eligible for State HS Credit, Course Abbreviation, Course Units, CTE Course, Subject, Subject Area.
- **How codes are built (from the TEDS CourseCode definition, https://tealprod.tea.state.tx.us/TWEDSAPI/34/0/0/DataComponents/DataElements/List/12883):**
  - 8 characters. The page states "Former Data Element Name: SERVICE-ID."
  - Locally developed courses have their last three digits assigned locally, shown as `XXX` in the table (e.g. `80100XXX`).
  - Prefixes seen in the table: `A` AP (40), `I` IB (78), `N` innovative (147), `CP` college prep courses with a partner college (one code per college, e.g. "CPC ELA - Austin Community College"), `LD` locally developed, `8…XXX` local-credit courses.
  - **There are no honors or Pre-AP codes.**
  - **The code can decide which graduation requirement a course meets.** "AP Computer Science A - MATH" and "AP Computer Science A - LOTE" have different codes.
  - **Dual credit isn't a code.** It is `DualCreditIndicator`, a Boolean on the transcript record (https://tealprod.tea.state.tx.us/TWEDSAPI/34/0/0/DataComponents/DataElements/List/12919), alongside a separate `OnRampsDualEnrollmentIndicator`.
- **License: restrictive.** TEA's site policy (https://tea.texas.gov/about-tea/welcome-and-overview/site-policies#copyright) says: "All content on this site is copyrighted by the Texas Education Agency and cannot be used without the express written permission of TEA," with exceptions only for Texas districts and residents' personal use. "If you are in Texas but are not an employee of a Texas public school district or charter school, you must get written approval from TEA … and enter into a license agreement that may involve paying a licensing fee or a royalty fee." Before shipping the table, ask Copyrights@tea.texas.gov for permission. This is not legal advice.
- **Verdict:** a good list to check printed Texas codes against. The license needs clearing before we redistribute titles and descriptions.

### 3.2 Tennessee: TDOE course codes

- **Tennessee Course Catalog (current):** https://ccms-search.tneducation.net/ (linked from https://www.tn.gov/education/districts/lea-operations/correlations-of-course-and-endorsment-codes.html). The app has a public, unauthenticated API at `https://ccms-search-api.tneducation.net/api`:
  - `GET search/getcurrentacademicyear` returns `{"academicYearId":41,"systemCode":"2026-2027",…,"totalCourseCount":3357}`.
  - `POST search/export/csv` (also `excel`, `json`, `pipe`) with body `{"academicYearId":41,"academicYearCode":"2026-2027","basicSearchTerms":[""],"changesOnly":false,"isAdvancedSearch":false,"minimumTermWeight":0,"pagingOptions":{"pageSize":10,"pageNumber":1,"sortColumns":[{"columnName":"Name","direction":"ASC"}]}}` returned a 3.6 MB CSV with **2,640 rows**.
  - The API reports 3,357 courses in total; the CSV has 2,640. My guess is the difference is unpublished or district courses, but I didn't confirm that.
  - **CSV columns:** Course Code, **Previous Course Code**, Publish State, Course Name, Short Name, Description, Credit Weight, Standards Url, **Retire Date** (611 rows have one), Date Last Published, Attributes, Endorsements, **Grades**, Notes, Course Type (G General 1,498 / C CTE 1,030 / S Special Populations 112), Content Area, Term Weight, Publish Status.
  - **Useful attributes:** "Graduation Requirements" (e.g. "Core Course (4th Year Math)"), "EPSO Identification" (Dual Enrollment 955, IB 259, Cambridge 96, AP 67, State Wide Dual Credit 13), Classification, CTE Career Cluster.
  - **Credit Weight needs normalizing:** values include `1`, `1.0`, `.5`, `0.5`, `0`, `n/a`, `3`, `6`.
- **How codes are built** (https://www.tn.gov/content/dam/tn/education/course-code/2020-21%20Course%20Code%20Nomenclature_1.10.20.pdf):
  - Course type letter (G/S/C/Y), then a two-digit content area, then a grade character (`H` = high school, `X` = multi-age, a digit = that grade), then a two-character sequence number. Example: "the course code for English I is G01H09."
  - The current catalog uses content areas the 2020 document doesn't list: **34 = IB (70 codes), 35 = Cambridge (47), 36 = AP (66)**.
  - High school courses taken in middle school have their own codes (`G02X02` "Algebra I (Grades 7 and/or 8)").
  - Honors has no separate code.
- **Older full spreadsheets** only go up to 2018-19: https://www.tn.gov/content/dam/tn/education/forms/ed2356_course_code_2018-19.xlsx.
- **License:** I found no open license. The tn.gov web policies only discuss public records (T.C.A. 10-7). Codes and titles are facts. Confirm with TDOE before republishing course descriptions. This is not legal advice.
- **Real validation result:**
  - I compared the 82 code–title pairs I parsed from Williamson County's 2026-27 guide with the 2026-27 catalog. 53 are active, 13 are retired (e.g. `G02H42` retired 2024-06-30; the current code for "Mathematical Reasoning For Decision Making" is `G02H97`), and 16 aren't in the current list (e.g. `G01H17` AP Language → now `G36H00`, `G02H24` AP Calculus AB → now `G36H04`).
  - The **Previous Course Code** column finds the replacement for all 16 missing codes.
  - `G01H00` is printed as Algebra I but is Advanced Creative Writing.
  - Local titles often differ from state titles: "Multicultural Minds" is `G01H01` Genre Literature.
- **Verdict:** the best of the three states for automation: an API, per-year catalogs, retire dates and previous-code history.

### 3.3 Utah: USBE CACTUS core codes

- **Download page:** https://schools.utah.gov/licensing/adminsupportscactus.php. The "CACTUS Course Codes" page (https://schools.utah.gov/curr/resources/cactuscoursecodes.php) has no list, only a contact.
  - **SY 2026-27:** https://schools.utah.gov/licensing/licensingfiles/Core_codes_SchoolYear2026-27.xlsx. 1,888 rows with columns `core_code, core_grad_credit (Y 580 / N 1,308), grade_low, grade_high, core_short_desc, active_inactive, effective_date, date_changed, AAS, retire_date, Valid_For, Catagory, description`. Dates are Excel serial numbers; 28 rows retire on 46568 = 2027-06-30.
  - **Earlier years:** https://schools.utah.gov/licensing/licensingfiles/2025CACTUSActiveCoreCodesJuly11_2025.xlsx and https://schools.utah.gov/licensing/licensingfiles/CourseCodes_SY%202024-25_July2_2024.xlsx. In the 2024-25 file the codes are **numbers that lost their leading zero** (10 digits instead of 11).
  - **Changes:** https://schools.utah.gov/licensing/licensingfiles/CourseCode%20Changes%20SY%202025-26.xlsx.
  - **Private schools list:** https://schools.utah.gov/licensing/licensingfiles/SY2027%20Core%20Course%20Codes.xlsx.
- **How codes are built (11 digits).** Examples: Secondary Mathematics II `07080000100`; Secondary Math II Extended/Honors `07080000105`; AP Calculus AB `07040000001`.
  - In this file, all 276 concurrent-enrollment ("CE") rows have `13` in digits 7–8.
  - SPED variants have `23`, and credit-recovery or original-credit "packet" variants have `18`/`19`.
  - I only observed this pattern; it isn't documented. Use the title and flags, not the digits.
  - **Utah is the only one of the three with separate honors/extended codes** (20 of them) and CE codes. The list also has 159 IB and 45 AP rows.
- **License:** the USBE terms (https://schools.utah.gov/termsofuse.php, section 4) allow anyone to "view, copy or distribute information … for personal or informational use … if the documents are not modified." They don't grant commercial reuse or derived works. Ask USBE. This is not legal advice.
- **Verdict:** usable as the Utah list, but Utah guides print local numbers. So matching is by title, then a human confirms.

### 3.4 Cross-state layer: NCES SCED (recommended)

- **Page:** https://nces.ed.gov/forum/sced.asp. **Version 13.0:** https://nces.ed.gov/sites/default/files/national-forum-education-statistics-nfes/document/2025/11/SCEDv13File_508.xlsx. About 1,791 current 5-digit codes with titles and descriptions, an archived-codes sheet with suggested replacements, and CTE career-cluster attributes. Excel drops the leading zero here too: `2056` should be `02056` Algebra II.
- **Codes:** "The SCED Identifier consists of four elements: Course Code, Course Level, Available Carnegie Unit Credit … and Sequence of Course." There are six course levels (Forum Guide, https://nces.ed.gov/pubs2014/2014802.pdf): **B** Basic/remedial, **G** General, **E** Enriched/advanced, **H** Honors, **C** College (credit-bearing at a college, which covers dual credit), **X** no specified level. AP and IB get their own course codes rather than a level. Finder: https://nces.ed.gov/scedfinder.
- **License:** "Is there a fee for SCED use? No. There is no licensing fee for SCED." (FAQ: https://nces.ed.gov/sites/default/files/national-forum-education-statistics-nfes/document/2025/11/SCED_FAQ_2021_508.pdf). It's also covered by the NCES public-domain statement.
- **None of the three state lists includes SCED codes.** Tennessee descriptions only say "adapted from … SCED." A state-to-SCED mapping would be a one-time reviewed job per state, about 1,000–1,900 secondary rows each.

**Recommendation:** use layers. A course printed on a guide becomes a verified **state code** (when the state has one and the code checks out), then a **SCED code + level**, then the app's existing generic `subject/level`. Store the guide's local title and code as printed. Map a course to a state code or SCED code only through code lookup plus human confirmation. The model only proposes candidates.

---

## 4. Hard cases for AI extraction (all observed above)

| Hard case | Example | What to do |
|---|---|---|
| Text order separates records from their titles | Georgetown (Crystal Reports): in the extracted text, each course's prerequisites, description, weight, credits and length come **before** its `Service ID / Course Key / Title` line. Reading in order gives every course the next course's description (the "CALCULUS AB AP" header is followed by the BC description). | Give the model rendered pages, not only the text layer. Ask for page and quote evidence per course. Check that the evidence quote sits near the title on the same page. |
| One word per line, tabs, broken files | Williamson County (printed from Chrome): one word per extracted line. West High (printed from macOS): words separated by tabs, and the PDF has structural errors. | Rebuild lines from the layout, or use page images. Repair the PDF before parsing. |
| Garbled characters and split words | Katy: "student‚Äôs", "origina l"; Herriman: "FANT ASY", "CUL TURE" | Normalize text. Don't check titles by exact match. |
| Encrypted PDFs that forbid copying | Jordan District packet (AES-256, P = -1052) | Detect encryption and permission flags, then decide on a policy (see section 6). |
| Wrong document | Enrollment packet (Jordan), master schedule posted as "Course Catalog" (North Sanpete, South Summit), one-page lists per grade (Jim Ned), "will be posted" (Haywood) | Classify the document first and tell the family exactly what's missing. A master schedule proves a course is offered but gives no credits or prerequisites. |
| Information only in color or layout | North Sanpete: grade level shown by cell color; Alcoa: sequence flowcharts that export as flattened text | Use rendered pages. Mark grade as `null` when only color carries it. |
| Staff personal data | Teacher names in schedules; PDF author metadata ("Author: Kori Thaxton"); advisor emails | Don't extract staff names. Strip file metadata before storing. |
| **Student** personal data | A parent may upload a filled-in course request card or schedule | Check locally before any AI call (look for "Student Name", ID and date-of-birth patterns). Reject student-specific documents. This is required by the rule that names never go to the AI provider. |
| Guides for a whole district | Katy, Georgetown, Williamson County; campus-only courses (Katy "Miller Career and Technology Center"; Northside magnet programs by campus; Highland courses at CTC/West/East) | Store the guide per district and link it to many schools. Keep `offered_at` as printed and let a person confirm availability at their school. |
| One school needs two guides | Utah 10–12 high schools with 7–9 junior highs; Plano Sr High (11–12) | Build the plan from two schools' guides. |
| Stale or changing each year | Runge 2024-25 still posted in 2026; Plano's new catalogs "coming soon"; Georgetown mid-year addenda; state codes retire yearly (TN retire dates, TX change log, UT `retire_date`) | Key everything by school year and cohort. Store the source hash and fetch date. Label stale guides. Re-check each registration season. |
| Several versions of one course | Katy `VIR`/`VIRID`/summer variants; Plano ALT/GM/RM; Northside "M" numbers; Georgetown CBLI/DB (English learner and special education sections) sharing one code | Extract them all, then merge in code into one base course with delivery or support variants. |
| Two levels in one entry | Runge "Algebra II/Algebra II Honors"; "Pre-Calculus/Pre-Calculus Honors" | Split into one course per level and record that they came from one entry. |
| Codes in the wrong field or stale | Williamson County `G01H00` "Algebra I"; retired and replaced codes | Validate every printed code against the state list for that year. Resolve replacements using previous codes. Flag title mismatches. |
| Scanned PDFs | Herriman's metadata points to a copier, yet the pages have text. I didn't find a guide that is only images, so OCR quality is unmeasured. | Check each page for a text layer. Don't trust metadata. |
| Pages behind JavaScript or bot checks | Plano (only 20 courses in the static HTML), Knox Career Guide (InDesign viewer), Alpine/Davis/Frisco challenge pages | Ask for an upload or a printed PDF. Don't promise automatic fetching. |
| Large documents | Katy 209 pages, Georgetown 179 | Split by page ranges. Cache results by file hash. Check the AI budget before extraction (`assertWithinBudget`). |

---

## 5. Proposed extraction schema

The model extracts only what is printed, word for word, with page evidence. Anything not stated is `null`. Code does all normalization, validation and mapping afterwards. The types are shown in TypeScript and translate directly to Zod for `betaZodOutputFormat`.

```ts
type Grade = 6 | 7 | 8 | 9 | 10 | 11 | 12;

type GuideExtraction = {
  document: {
    kind: "course_catalog" | "program_of_studies" | "course_offerings_list" | "master_schedule"
        | "graduation_requirements" | "registration_packet" | "student_specific" | "other";
    title_verbatim: string | null;
    school_year_verbatim: string | null;       // "2026-2027" as printed; null if absent
    cohort_note_verbatim: string | null;       // "students entering 9th grade prior to 2026-2027"
    publisher_level: "school" | "district" | "charter" | "unknown";
    publisher_name_verbatim: string | null;
    campuses_named: string[];                  // campuses the guide says it covers
    grades_covered: Grade[];
    state_code_system_seen: "tx_course_code" | "tn_course_code" | "ut_core_code" | "none" | "unclear";
    schedule_note_verbatim: string | null;     // "4x4 block", "A/B", "0.5 credit per semester"
    pages_unreadable: number[];
    warnings: string[];                        // e.g. "grade shown only by cell color"
  };
  courses: Array<{
    ref: string;                               // extraction-local id, e.g. "p63-3"
    title_verbatim: string;
    local_codes: string[];                     // "0253", "53110", "ALG2H", "61212400"
    state_code_printed: string | null;         // exactly as printed; validated later in code
    subject_verbatim: string | null;           // section heading it appears under
    level_label_verbatim: string | null;       // "KAP", "Extended", "ACP", "Honors", "SDC"
    level: "regular" | "honors_or_advanced" | "ap" | "ib" | "cambridge" | "dual_or_concurrent"
         | "cte" | "support_or_remedial" | "special_education" | "english_learner"
         | "credit_recovery" | "unknown";
    college_partner_verbatim: string | null;   // "Victoria College", "SLCC"
    college_course_numbers: string[];          // "ENGL 1301", "Math 1050"
    grades_allowed: Grade[] | null;            // only if printed
    credits_verbatim: string | null;           // "1.0 credits", "Credit: ½", "SEM: 2 CR: 1"
    credits_value: number | null;
    length_verbatim: string | null;            // "Full year course", "One Semester", "YR"
    prerequisites_verbatim: string | null;
    prerequisites: Array<{
      course_ref_verbatim: string;             // "Secondary Math 1H", "Alg 1"
      min_grade_verbatim: string | null;       // "grade C or higher"
      concurrent_allowed: boolean | null;
      any_of_group: number | null;             // same number = alternatives
    }>;
    corequisites_verbatim: string | null;
    approvals: Array<"teacher_recommendation" | "application" | "audition_or_tryout"
                   | "test_score" | "counselor" | "committee_placement">;
    satisfies_verbatim: string[];              // "Core Math", "3rd year Math", "Digital Studies, CTE or Elective"
    offered_at_verbatim: string | null;        // "CTC", "Miller Career and Technology Center"
    delivery: "in_person" | "virtual" | "summer" | "interactive_video" | "unknown";
    flags: {
      ncaa_approved: boolean | null;
      weighted_verbatim: string | null;
      state_exam: boolean | null;              // EOC
      fee_mentioned: boolean | null;
    };
    variant_of_ref: string | null;             // VIR/summer/EL/SPED section of another extracted course
    combined_entry_group: string | null;       // e.g. "Algebra II/Algebra II Honors" split into two
    evidence: Array<{ page: number; quote: string }>;  // quote <= 200 chars, verbatim
    confidence: "high" | "medium" | "low";
  }>;
  sequences: Array<{                           // printed pathways/tracks only
    name_verbatim: string;
    steps: Array<{ grade: Grade | null; course_refs_verbatim: string[] }>;
    rule_verbatim: string | null;              // "must take Geometry and Algebra 2 by sophomore year"
    page: number;
  }>;
  graduation_plans: Array<{
    name_verbatim: string;
    cohorts_verbatim: string | null;           // "Class of 2029 and thereafter"
    total_credits: number | null;
    areas: Array<{ area_verbatim: string; credits: number | null; named_courses_verbatim: string[] }>;
    page: number;
  }>;
  gpa_rules_verbatim: Array<{ text: string; page: number }>;  // stored as printed, never interpreted by the model
};
```

**Rules for the model's instructions**
- Leave a field `null` when it isn't printed. Never infer grades, credits or prerequisites from a course title.
- Never extract person names, emails or phone numbers.
- One record per course per level. A code that sits beside a title becomes `state_code_printed` only if it's clearly labeled or in the guide's code column.

**Fields code adds afterwards (never the model)**
- `state_code_status`: active / retired → replacement / not in list / title mismatch, checked against the state list for that school year.
- `canonical_state_code`, `sced_code`, `sced_level`, `app_course_type`.
- `merged_into` (variant merging) and `human_confirmed_by` / `at`.

---

## 6. Suggested pipeline and product notes

1. **Intake.** Accept a URL or an upload.
   - Google Docs: fetch `…/export?format=txt` (I checked this on Farragut and Alcoa). For a Drive-hosted Word file like Farragut's, the same export also returned text.
   - Published Google Sheets: fetch `…/pub?…&output=csv`.
   - JavaScript catalogs: ask for a PDF.
   - Store the source URL, a sha256 hash and the fetch date.
2. **Checks on our servers before any AI call:**
   - Page count, text layer per page, encryption and permission flags.
   - PII heuristics (reject documents about a specific student).
   - Strip PDF metadata.
   - Decide a policy for "no copying" PDFs, e.g. require the family to confirm the document is published by the school, or skip.
3. **Classify, then extract** in page chunks with rendered pages, using structured outputs. Call `recordMessageUsage` and then `readStructuredOutput`.
4. **Validate in code:**
   - State codes against the state list for that year, including replacements for retired codes.
   - Credits in a plausible set and grades within 6–12.
   - Every prerequisite resolves to an extracted course.
   - Coverage check: ELA, math, science and social studies must all be present, or flag the guide.
   - Merge variants.
5. **Human confirmation** of the changes and of low-confidence rows. Save by (NCES school ID or district LEAID, school year, cohort). Share confirmed guides only. Label guides whose `school_year` is older than the current year as stale.
6. **Fallback** when there is no guide or it's unconfirmed: the generic course types from SCED + level, and the state's graduation minimum (e.g. Utah 24 credits).

---

## 7. Limits and open questions

- WebSearch ran out, so I found the guides by following links from district and school sites. The sample is real but not random. I didn't find a guide that is only scanned images.
- TEA's license for the course code table needs a written request before commercial use. USBE's and TDOE's terms don't clearly allow commercial reuse. Codes and titles are facts, but descriptions are copyrighted text. Get counsel's view. This is not legal advice.
- District guides are copyrighted by the districts. I suggest storing facts plus short evidence quotes and linking to the source, not republishing full descriptions.
- I couldn't confirm what Northside's "M" variants or Plano's "GM/RM" variants mean. The pages don't define them.
- CCD has no feeder patterns (which junior high feeds which high school). A family has to tell us.

---

## Sources

**NCES / federal**
- CCD file finder: https://nces.ed.gov/ccd/files.asp
- 2024-25 directory: https://nces.ed.gov/ccd/Data/zip/ccd_sch_029_2425_w_1a_073025.zip
- 2024-25 directory companion: https://nces.ed.gov/ccd/xls/SY_2024-25_SCH_Directory_Companion_2026-005d.xlsx
- 2025-26 preliminary directory: https://nces.ed.gov/ccd/data/zip/ccd_sch_029_2526_w_0a_050626.zip
- 2024-25 school characteristics: https://nces.ed.gov/ccd/Data/zip/ccd_sch_129_2425_w_1a_073025.zip
- 2024-25 LEA membership: https://nces.ed.gov/ccd/Data/zip/ccd_lea_052_2425_l_1a_073025.zip
- EDGE school locations: https://nces.ed.gov/programs/edge/Geographic/SchoolLocations
- NCES public-domain statement: https://nces.ed.gov/help/privacy.asp
- PSS data page: https://nces.ed.gov/surveys/pss/pssdata.asp
- PSS 2023-24 CSV: https://nces.ed.gov/surveys/pss/zip/pss2324_pu_csv.zip
- PSS codebook: https://nces.ed.gov/surveys/pss/pdf/codebook2023_24.pdf
- PSS readme: https://nces.ed.gov/surveys/pss/pdf/Readme2023_24.pdf
- SCED page: https://nces.ed.gov/forum/sced.asp
- SCED v13: https://nces.ed.gov/sites/default/files/national-forum-education-statistics-nfes/document/2025/11/SCEDv13File_508.xlsx
- SCED FAQ: https://nces.ed.gov/sites/default/files/national-forum-education-statistics-nfes/document/2025/11/SCED_FAQ_2021_508.pdf
- SCED Forum Guide: https://nces.ed.gov/pubs2014/2014802.pdf

**Texas**
- 2026-27 course codes reference: https://tealprod.tea.state.tx.us/TWEDSAPI/34/0/0/References/CourseCodes
- 2026-27 course code table: https://www.texasstudentdatasystem.org/tsdsabout/tsds-upgrade-project/2026-2027-addendum-course-information.xlsx
- 2026-27 course codes change log: https://www.texasstudentdatasystem.org/tsdsabout/tsds-upgrade-project/2026-2027-addendum-cumulative-coursecodes-change-log.pdf
- CourseCode definition: https://tealprod.tea.state.tx.us/TWEDSAPI/34/0/0/DataComponents/DataElements/List/12883
- DualCreditIndicator definition: https://tealprod.tea.state.tx.us/TWEDSAPI/34/0/0/DataComponents/DataElements/List/12919
- Legacy code tables (C022): https://tealprod.tea.state.tx.us/TWEDS/103/0/0/0/CodeTable/DownloadAll
- TEA copyright policy: https://tea.texas.gov/about-tea/welcome-and-overview/site-policies
- District guides: all Texas URLs in the section 2 table (Katy, Northside, Plano, Georgetown, Jim Ned, Runge).

**Tennessee**
- Course codes page: https://www.tn.gov/education/districts/lea-operations/correlations-of-course-and-endorsment-codes.html
- Course catalog app: https://ccms-search.tneducation.net/
- Catalog API: https://ccms-search-api.tneducation.net/api/search/getcurrentacademicyear
- Code nomenclature: https://www.tn.gov/content/dam/tn/education/course-code/2020-21%20Course%20Code%20Nomenclature_1.10.20.pdf
- tn.gov web policies: https://www.tn.gov/web-policies.html
- District guides: all Tennessee URLs in the section 2 table (Williamson County, Knox County (Farragut, West High, Career Guide), Science Hill, Alcoa, Haywood County).

**Utah**
- Core codes download page: https://schools.utah.gov/licensing/adminsupportscactus.php
- 2026-27 core codes: https://schools.utah.gov/licensing/licensingfiles/Core_codes_SchoolYear2026-27.xlsx
- Graduation requirements: https://schools.utah.gov/curr/graduationrequirements.php
- USBE terms of use: https://schools.utah.gov/termsofuse.php
- District guides: all Utah URLs in the section 2 table (Herriman High, Jordan District, Highland High, North Sanpete High, South Summit High, NUAMES).

Local copies of the parsed files, including the TN 2026-27 catalog CSV export, the TX and UT code tables, CCD and PSS, and the guide PDFs, are in `/private/tmp/claude-501/-Users-stevejonas-CollegeCompass/e4b3e12b-d226-482e-b735-d3db30654eb2/scratchpad/r/`.
