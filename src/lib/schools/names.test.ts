import { describe, expect, it } from "vitest";
import { displaySchoolName, gradeSpanLabel, schoolSearchQuery, schoolSearchText, searchWords, titleCase } from "./names";

// Names as the NCES files print them (CCD 2024-25, PSS 2023-24).
describe("displaySchoolName", () => {
  it("title-cases names filed in capitals and spells out the usual abbreviations", () => {
    expect(displaySchoolName("PLANO SR H S")).toBe("Plano Senior High School");
    expect(displaySchoolName("PLANO EAST SR H S")).toBe("Plano East Senior High School");
    expect(displaySchoolName("PLANO WEST SENIOR H S")).toBe("Plano West Senior High School");
    expect(displaySchoolName("ASPERMONT H S")).toBe("Aspermont High School");
    expect(displaySchoolName("POR VIDA ACADEMY CHARTER H S")).toBe("Por Vida Academy Charter High School");
    expect(displaySchoolName("DRIPPING SPRINGS MIDDLE")).toBe("Dripping Springs Middle");
    expect(displaySchoolName("MT. PILGRIM CHRISTIAN ACADEMY")).toBe("Mt. Pilgrim Christian Academy");
    expect(displaySchoolName("HOLY FAMILY CRISTO REY CATHOLIC HIGH SCHOOL")).toBe("Holy Family Cristo Rey Catholic High School");
  });

  it("keeps acronyms, a leading El, and names that are part of a person's name", () => {
    expect(displaySchoolName("CROSBYTON CISD PRE K-12")).toBe("Crosbyton CISD Pre K-12");
    expect(displaySchoolName("PLANO JJAEP")).toBe("Plano JJAEP");
    expect(displaySchoolName("EL PASO H S")).toBe("El Paso High School");
    expect(displaySchoolName("KIPP AUSTIN COLLEGIATE")).toBe("KIPP Austin Collegiate");
    // "JR" here is part of a name, so it isn't spelled "Junior".
    expect(displaySchoolName("M L KING JR H S")).toBe("M L King Jr High School");
    expect(displaySchoolName("MCKINNEY NORTH H S")).toBe("McKinney North High School");
    expect(displaySchoolName("ST. MARY'S ACADEMY")).toBe("St. Mary's Academy");
    expect(displaySchoolName("SCHOOL OF THE ARTS")).toBe("School of the Arts");
  });

  it("leaves names with lowercase letters as the school reported them", () => {
    expect(displaySchoolName("  Alcoa  High School ")).toBe("Alcoa High School");
    expect(displaySchoolName("American Preparatory Academy - Draper #3")).toBe("American Preparatory Academy - Draper #3");
  });
});

describe("titleCase", () => {
  it("title-cases cities", () => {
    expect(titleCase("WEST VALLEY CITY")).toBe("West Valley City");
    expect(titleCase("WINSTON-SALEM")).toBe("Winston-Salem");
    expect(titleCase("Price")).toBe("Price");
  });
});

describe("search text and queries", () => {
  it("indexes both spellings of a name, the city and the district, once each", () => {
    const text = schoolSearchText({ rawName: "PLANO SR H S", name: "Plano Senior High School", city: "PLANO", district: "Plano ISD" });
    expect(text).toBe("plano sr h s senior high school isd");
  });

  it("drops accents, apostrophes and punctuation", () => {
    expect(searchWords("Zoë's  Café-Bistro")).toBe("zoes cafe bistro");
    expect(searchWords("St. Mary’s")).toBe("st marys");
  });

  it("turns typed words into a prefix query, never passing through search syntax", () => {
    expect(schoolSearchQuery("Plano Sr")).toBe("plano:* & sr:*");
    expect(schoolSearchQuery("st. mary's")).toBe("st:* & marys:*");
    expect(schoolSearchQuery("a & b | !c:*")).toBe("a:* & b:* & c:*");
    expect(schoolSearchQuery("  --  ")).toBeNull();
    expect(schoolSearchQuery("one two three four five six seven eight")).toBe("one:* & two:* & three:* & four:* & five:* & six:*");
  });
});

describe("gradeSpanLabel", () => {
  it("names grades the way schools do", () => {
    expect(gradeSpanLabel(9, 12)).toBe("Grades 9–12");
    expect(gradeSpanLabel(0, 8)).toBe("Grades K–8");
    expect(gradeSpanLabel(-1, 12)).toBe("Grades PK–12");
    expect(gradeSpanLabel(12, 12)).toBe("Grade 12");
    expect(gradeSpanLabel(null, 12)).toBeNull();
  });
});
