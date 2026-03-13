const courseCatalog = [
    {
      id: "test-course",
      name: "Test Course",
      description: "Draft course created in the local visual editor.",
      width: 960,
      height: 540,
      tee: {
        x: 137,
        y: 411
      },
      hole: {
        x: 853,
        y: 75,
        radius: 18
      },
      walls: [
        {
          x: 720,
          y: 45,
          width: 35,
          height: 105
        },
        {
          x: 745,
          y: 220,
          width: 120,
          height: 25
        },
        {
          x: 125,
          y: 275,
          width: 125,
          height: 25
        },
        {
          x: 325,
          y: 250,
          width: 25,
          height: 150
        },
        {
          x: 520,
          y: 240,
          width: 60,
          height: 60
        },
        {
          x: 125,
          y: 125,
          width: 30,
          height: 105
        },
        {
          x: 575,
          y: 0,
          width: 25,
          height: 75
        },
        {
          x: 630,
          y: 430,
          width: 40,
          height: 110
        }
      ],
      sandTraps: [
        {
          x: 435,
          y: 65,
          width: 150,
          height: 75
        },
        {
          x: 425,
          y: 425,
          width: 120,
          height: 50
        }
      ],
      accents: [
        {
          x: 165,
          y: 90,
          width: 100,
          height: 50
        },
        {
          x: 720,
          y: 425,
          width: 110,
          height: 45
        },
        {
          x: 600,
          y: 25,
          width: 50,
          height: 15
        },
        {
          x: 100,
          y: 375,
          width: 75,
          height: 70
        },
        {
          x: 605,
          y: 180,
          width: 70,
          height: 45
        }
      ]
    },
];

export const COURSE_CATALOG = courseCatalog;

function cloneRectangle(rect) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
}

function cloneCourse(course) {
  return {
    id: course.id,
    name: course.name,
    description: course.description,
    width: course.width,
    height: course.height,
    tee: {
      x: course.tee.x,
      y: course.tee.y
    },
    hole: {
      x: course.hole.x,
      y: course.hole.y,
      radius: course.hole.radius
    },
    walls: course.walls.map(cloneRectangle),
    sandTraps: course.sandTraps.map(cloneRectangle),
    accents: course.accents.map(cloneRectangle)
  };
}

export function getCourseById(courseId) {
  return courseCatalog.find((course) => course.id === courseId) ?? courseCatalog[0];
}

export function getCourseCatalog() {
  return courseCatalog.map(cloneCourse);
}

export function getCourseSummaries() {
  return courseCatalog.map(({ id, name, description }) => ({
    id,
    name,
    description
  }));
}
