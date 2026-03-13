import { CourseRenderer } from "./courseRenderer.js";

const COURSE_API_URL = "/api/courses";
const DRAFT_STORAGE_KEY = "minigode-course-editor-draft";
const COLOR_MODE_KEY = "minigode-color-mode";
const GRID_MODE_KEY = "minigode-course-editor-grid-mode";
const MIN_RECT_SIZE = 12;
const MIN_COURSE_WIDTH = 320;
const MIN_COURSE_HEIGHT = 240;
const MAX_COURSE_WIDTH = 2400;
const MAX_COURSE_HEIGHT = 1800;
const COURSE_DIMENSION_STEP = 10;
const GRID_SNAP_STEP = 5;
const COPY_BUTTON_FEEDBACK_MS = 1000;
const GRID_MAJOR_STEP = GRID_SNAP_STEP * 5;
const DEFAULT_HOLE_RADIUS = 18;
const MIN_HOLE_RADIUS = 10;
const MAX_HOLE_RADIUS = 60;
const SELECTABLE_RECT_TYPES = ["walls", "sandTraps", "accents"];
const TOOL_DEFINITIONS = [
  { id: "select", label: "Select", shortcut: "V", description: "Select and move existing objects." },
  { id: "wall", label: "Wall", shortcut: "W", description: "Drag to create a collision wall rectangle." },
  { id: "sand", label: "Sand", shortcut: "S", description: "Drag to create a sand trap rectangle." },
  { id: "accent", label: "Accent", shortcut: "A", description: "Drag to create a decorative accent rectangle." },
  { id: "tee", label: "Tee", shortcut: "T", description: "Click to place the tee location." },
  { id: "hole", label: "Hole", shortcut: "H", description: "Click to place the hole center." }
];
const TOOL_SHORTCUTS = new Map(TOOL_DEFINITIONS.map((tool) => [tool.shortcut.toLowerCase(), tool.id]));
const RECT_TOOL_TO_FIELD = {
  wall: "walls",
  sand: "sandTraps",
  accent: "accents"
};
const RECT_FIELD_LABELS = {
  walls: "Wall",
  sandTraps: "Sand trap",
  accents: "Accent"
};

const state = {
  catalog: [],
  sourceCourseId: null,
  course: createBlankCourse(),
  selectedTool: "select",
  selectedTarget: null,
  interaction: null,
  pointerWorld: null,
  statusMessage: "Loading course catalog...",
  colorMode: loadStoredColorMode(),
  gridModeEnabled: loadStorage(GRID_MODE_KEY) ?? false
};

let elements;
let renderer;
const copyButtonTimers = new WeakMap();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCoordinate(value) {
  return Math.round(Number(value) || 0);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

function saveStorage(key, value) {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore local storage failures in the local tooling page.
  }
}

function loadStoredColorMode() {
  const value = loadStorage(COLOR_MODE_KEY);
  return value === "dark" ? "dark" : "light";
}

function saveStoredColorMode() {
  saveStorage(COLOR_MODE_KEY, state.colorMode);
}

function createBlankCourse() {
  return normalizeCourse({
    id: "new-course",
    name: "New Course",
    description: "Draft course created in the local visual editor.",
    width: 960,
    height: 540,
    tee: { x: 122, y: 270 },
    hole: { x: 838, y: 270, radius: DEFAULT_HOLE_RADIUS },
    walls: [],
    sandTraps: [],
    accents: []
  });
}

function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizePoint(point, width, height, padding = 0, fallback = { x: padding, y: padding }) {
  return {
    x: clamp(roundCoordinate(point?.x ?? fallback.x), padding, width - padding),
    y: clamp(roundCoordinate(point?.y ?? fallback.y), padding, height - padding)
  };
}

function normalizeRect(rect, courseWidth, courseHeight) {
  const rawX = Number(rect?.x) || 0;
  const rawY = Number(rect?.y) || 0;
  const rawWidth = Number(rect?.width) || 0;
  const rawHeight = Number(rect?.height) || 0;
  const minX = Math.min(rawX, rawX + rawWidth);
  const minY = Math.min(rawY, rawY + rawHeight);
  const maxX = Math.max(rawX, rawX + rawWidth);
  const maxY = Math.max(rawY, rawY + rawHeight);
  const x = clamp(roundCoordinate(minX), 0, courseWidth);
  const y = clamp(roundCoordinate(minY), 0, courseHeight);
  const width = clamp(roundCoordinate(maxX - minX), 0, courseWidth - x);
  const height = clamp(roundCoordinate(maxY - minY), 0, courseHeight - y);

  if (width < MIN_RECT_SIZE || height < MIN_RECT_SIZE) {
    return null;
  }

  return { x, y, width, height };
}

function normalizeCourse(rawCourse) {
  const width = clamp(roundCoordinate(rawCourse?.width ?? 960), MIN_COURSE_WIDTH, MAX_COURSE_WIDTH);
  const height = clamp(roundCoordinate(rawCourse?.height ?? 540), MIN_COURSE_HEIGHT, MAX_COURSE_HEIGHT);
  const holeRadius = clamp(roundCoordinate(rawCourse?.hole?.radius ?? DEFAULT_HOLE_RADIUS), MIN_HOLE_RADIUS, MAX_HOLE_RADIUS);
  const hole = normalizePoint(rawCourse?.hole, width, height, holeRadius, {
    x: width - 120,
    y: Math.round(height / 2)
  });
  const tee = normalizePoint(rawCourse?.tee, width, height, 14, {
    x: 120,
    y: Math.round(height / 2)
  });

  return {
    id: normalizeText(rawCourse?.id, "new-course"),
    name: normalizeText(rawCourse?.name, "New Course"),
    description: normalizeText(rawCourse?.description, "Draft course created in the local visual editor."),
    width,
    height,
    tee,
    hole: {
      x: clamp(hole.x, holeRadius, width - holeRadius),
      y: clamp(hole.y, holeRadius, height - holeRadius),
      radius: holeRadius
    },
    walls: Array.isArray(rawCourse?.walls)
      ? rawCourse.walls.map((rect) => normalizeRect(rect, width, height)).filter(Boolean)
      : [],
    sandTraps: Array.isArray(rawCourse?.sandTraps)
      ? rawCourse.sandTraps.map((rect) => normalizeRect(rect, width, height)).filter(Boolean)
      : [],
    accents: Array.isArray(rawCourse?.accents)
      ? rawCourse.accents.map((rect) => normalizeRect(rect, width, height)).filter(Boolean)
      : []
  };
}

function normalizeStepValue(rawValue, min, max, step, fallback) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const stepped = Math.round(value / step) * step;
  return clamp(stepped, min, max);
}

function snapCoordinate(value, step = GRID_SNAP_STEP) {
  return Math.round((Number(value) || 0) / step) * step;
}

function snapPoint(point, course) {
  return {
    x: clamp(snapCoordinate(point.x), 0, course.width),
    y: clamp(snapCoordinate(point.y), 0, course.height)
  };
}

function formatCourseObject(course) {
  return JSON.stringify(course, null, 2).replace(/"([A-Za-z_$][\w$]*)":/g, "$1:");
}

function formatRectSummary(rect) {
  return `${rect.x}, ${rect.y} - ${rect.width} x ${rect.height}`;
}

function setStatus(message) {
  state.statusMessage = message;
  if (elements) {
    elements.editorStatus.textContent = message;
  }
}

function isEditableElement(node) {
  const tagName = node?.tagName?.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function loadStoredDraft() {
  const stored = loadStorage(DRAFT_STORAGE_KEY);
  return stored ? normalizeCourse(stored) : null;
}

function persistDraft() {
  saveStorage(DRAFT_STORAGE_KEY, state.course);
}

function getColorModeButtonIcon() {
  return state.colorMode === "dark" ? "☀" : "☾";
}

function getColorModeButtonHint() {
  return state.colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

function applyColorMode() {
  document.body.classList.toggle("theme-dark", state.colorMode === "dark");
  document.body.classList.toggle("theme-light", state.colorMode !== "dark");
  if (elements?.themeToggleButton) {
    elements.themeToggleButton.innerHTML = `<span class="mode-toggle-icon" aria-hidden="true">${getColorModeButtonIcon()}</span>`;
    elements.themeToggleButton.setAttribute("aria-label", getColorModeButtonHint());
    elements.themeToggleButton.setAttribute("title", getColorModeButtonHint());
  }
}

function getToolDefinition(toolId = state.selectedTool) {
  return TOOL_DEFINITIONS.find((tool) => tool.id === toolId) ?? TOOL_DEFINITIONS[0];
}

function getSelectedRectCollectionName(target = state.selectedTarget) {
  return target && SELECTABLE_RECT_TYPES.includes(target.type) ? target.type : null;
}

function ensureSelectedTargetIsValid() {
  if (!state.selectedTarget) {
    return;
  }

  if (state.selectedTarget.type === "tee" || state.selectedTarget.type === "hole") {
    return;
  }

  const collectionName = getSelectedRectCollectionName(state.selectedTarget);
  if (!collectionName || !state.course[collectionName][state.selectedTarget.index]) {
    state.selectedTarget = null;
  }
}

function updateCourse(mutator, nextStatusMessage = null, options = {}) {
  const { persist = true, fullRender = true } = options;
  const nextCourse = deepClone(state.course);
  mutator(nextCourse);
  state.course = normalizeCourse(nextCourse);
  ensureSelectedTargetIsValid();
  if (persist) {
    persistDraft();
  }
  if (fullRender) {
    render();
  } else {
    drawEditor();
  }
  if (nextStatusMessage) {
    setStatus(nextStatusMessage);
  }
}

function loadCourse(course, { markAsSource = true, nextStatusMessage = null } = {}) {
  state.course = normalizeCourse(deepClone(course));
  state.selectedTarget = null;
  state.interaction = null;
  state.sourceCourseId = markAsSource ? state.course.id : null;
  persistDraft();
  render();
  if (nextStatusMessage) {
    setStatus(nextStatusMessage);
  }
}

function copyCurrentCourse(newId) {
  const course = deepClone(state.course);
  course.id = newId;
  course.name = `${course.name} Copy`;
  return normalizeCourse(course);
}

function getRectCollection(fieldName) {
  return state.course[fieldName];
}

function getSelectedEntity() {
  if (!state.selectedTarget) {
    return null;
  }

  if (state.selectedTarget.type === "tee") {
    return state.course.tee;
  }

  if (state.selectedTarget.type === "hole") {
    return state.course.hole;
  }

  const collectionName = getSelectedRectCollectionName();
  return collectionName ? getRectCollection(collectionName)[state.selectedTarget.index] ?? null : null;
}

function selectTarget(target) {
  state.selectedTarget = target;
  renderSelectionPanel();
  renderObjectList();
  drawEditor();
}

function getWorldPoint(event) {
  const point = renderer.screenToWorld(event, state.course);
  return state.gridModeEnabled ? snapPoint(point, state.course) : point;
}

function isPointInsideRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function hitTest(point) {
  const holeDistance = Math.hypot(point.x - state.course.hole.x, point.y - state.course.hole.y);
  if (holeDistance <= state.course.hole.radius + 10) {
    return { type: "hole" };
  }

  const teeDistance = Math.hypot(point.x - state.course.tee.x, point.y - state.course.tee.y);
  if (teeDistance <= 18) {
    return { type: "tee" };
  }

  for (const fieldName of SELECTABLE_RECT_TYPES) {
    for (let index = state.course[fieldName].length - 1; index >= 0; index -= 1) {
      if (isPointInsideRect(point, state.course[fieldName][index])) {
        return { type: fieldName, index };
      }
    }
  }

  return null;
}

function clampRectPosition(rect, course) {
  return {
    x: clamp(roundCoordinate(rect.x), 0, course.width - rect.width),
    y: clamp(roundCoordinate(rect.y), 0, course.height - rect.height),
    width: rect.width,
    height: rect.height
  };
}

function describeSelectedTarget() {
  if (!state.selectedTarget) {
    return "Nothing selected";
  }

  if (state.selectedTarget.type === "tee") {
    return "Tee";
  }

  if (state.selectedTarget.type === "hole") {
    return "Hole";
  }

  return `${RECT_FIELD_LABELS[state.selectedTarget.type]} ${state.selectedTarget.index + 1}`;
}

function updatePointerLabel() {
  if (!state.pointerWorld) {
    elements.editorPointer.textContent = "x: -, y: -";
    return;
  }

  elements.editorPointer.textContent = `x: ${roundCoordinate(state.pointerWorld.x)}, y: ${roundCoordinate(state.pointerWorld.y)}`;
}

function syncCourseInputs() {
  if (elements.courseIdInput !== document.activeElement) {
    elements.courseIdInput.value = state.course.id;
  }
  if (elements.courseNameInput !== document.activeElement) {
    elements.courseNameInput.value = state.course.name;
  }
  if (elements.courseDescriptionInput !== document.activeElement) {
    elements.courseDescriptionInput.value = state.course.description;
  }
  if (elements.courseWidthInput !== document.activeElement) {
    elements.courseWidthInput.value = String(state.course.width);
  }
  if (elements.courseHeightInput !== document.activeElement) {
    elements.courseHeightInput.value = String(state.course.height);
  }
}

function renderToolPalette() {
  elements.toolPalette.innerHTML = TOOL_DEFINITIONS.map(
    (tool) => `
      <button
        type="button"
        class="secondary course-editor-tool ${tool.id === state.selectedTool ? "is-active" : ""}"
        data-tool="${tool.id}"
      >
        <span class="course-editor-tool__label">${tool.label}</span>
        <span class="course-editor-tool__shortcut">${tool.shortcut}</span>
      </button>
    `
  ).join("");
}

function renderGridToggle() {
  elements.gridToggleButton.classList.toggle("is-active", state.gridModeEnabled);
  elements.gridToggleButton.textContent = state.gridModeEnabled ? `Grid ${GRID_SNAP_STEP} On` : `Grid ${GRID_SNAP_STEP} Off`;
  elements.gridToggleButton.setAttribute("aria-pressed", state.gridModeEnabled ? "true" : "false");
}

function renderObjectList() {
  const groups = [
    {
      key: "tee",
      label: "Tee",
      items: [{ target: { type: "tee" }, summary: `${state.course.tee.x}, ${state.course.tee.y}` }]
    },
    {
      key: "hole",
      label: "Hole",
      items: [
        {
          target: { type: "hole" },
          summary: `${state.course.hole.x}, ${state.course.hole.y} - r ${state.course.hole.radius}`
        }
      ]
    },
    ...SELECTABLE_RECT_TYPES.map((fieldName) => ({
      key: fieldName,
      label: RECT_FIELD_LABELS[fieldName],
      items: state.course[fieldName].map((rect, index) => ({
        target: { type: fieldName, index },
        summary: formatRectSummary(rect)
      }))
    }))
  ];

  elements.objectList.innerHTML = groups
    .map(
      (group) => `
        <section class="course-editor-group">
          <div class="course-editor-group__header">
            <h3>${group.label}</h3>
            <span class="course-editor-count">${group.items.length}</span>
          </div>
          <div class="course-editor-group__items">
            ${
              group.items.length
                ? group.items
                    .map((item, index) => {
                      const isSelected =
                        state.selectedTarget?.type === item.target.type &&
                        state.selectedTarget?.index === item.target.index;
                      const label = item.target.type === "tee" || item.target.type === "hole"
                        ? group.label
                        : `${group.label} ${index + 1}`;

                      return `
                        <button
                          type="button"
                          class="course-editor-object-button ${isSelected ? "is-selected" : ""}"
                          data-target-type="${item.target.type}"
                          ${item.target.index !== undefined ? `data-target-index="${item.target.index}"` : ""}
                        >
                          <strong>${label}</strong>
                          <span>${item.summary}</span>
                        </button>
                      `;
                    })
                    .join("")
                : `<p class="course-editor-note">No ${group.label.toLowerCase()} objects yet.</p>`
            }
          </div>
        </section>
      `
    )
    .join("");
}

function renderSelectionPanel() {
  const entity = getSelectedEntity();
  const coordinateStep = state.gridModeEnabled ? GRID_SNAP_STEP : 1;
  elements.selectionTitle.textContent = describeSelectedTarget();

  if (!entity || !state.selectedTarget) {
    elements.selectionPanel.innerHTML = `
      <p class="course-editor-selection__empty">
        Select an existing item on the canvas, or choose a drawing tool to add a new wall, sand trap, accent, tee,
        or hole.
      </p>
    `;
    return;
  }

  if (state.selectedTarget.type === "tee") {
    elements.selectionPanel.innerHTML = `
      <div class="course-editor-grid">
        <label>
          X
          <input data-selection-field="x" type="number" min="0" max="${state.course.width}" step="${coordinateStep}" value="${entity.x}">
        </label>
        <label>
          Y
          <input data-selection-field="y" type="number" min="0" max="${state.course.height}" step="${coordinateStep}" value="${entity.y}">
        </label>
      </div>
      <p class="course-editor-note">The tee is where every player ball spawns.</p>
    `;
    return;
  }

  if (state.selectedTarget.type === "hole") {
    elements.selectionPanel.innerHTML = `
      <div class="course-editor-grid">
        <label>
          X
          <input data-selection-field="x" type="number" min="0" max="${state.course.width}" step="${coordinateStep}" value="${entity.x}">
        </label>
        <label>
          Y
          <input data-selection-field="y" type="number" min="0" max="${state.course.height}" step="${coordinateStep}" value="${entity.y}">
        </label>
        <label>
          Radius
          <input
            data-selection-field="radius"
            type="number"
            min="${MIN_HOLE_RADIUS}"
            max="${MAX_HOLE_RADIUS}"
            step="1"
            value="${entity.radius}"
          >
        </label>
      </div>
      <p class="course-editor-note">The hole radius controls how forgiving the cup is.</p>
    `;
    return;
  }

  elements.selectionPanel.innerHTML = `
    <div class="course-editor-grid">
      <label>
        X
        <input data-selection-field="x" type="number" min="0" max="${state.course.width}" step="${coordinateStep}" value="${entity.x}">
      </label>
      <label>
        Y
        <input data-selection-field="y" type="number" min="0" max="${state.course.height}" step="${coordinateStep}" value="${entity.y}">
      </label>
      <label>
        Width
        <input data-selection-field="width" type="number" min="${MIN_RECT_SIZE}" max="${state.course.width}" step="${coordinateStep}" value="${entity.width}">
      </label>
      <label>
        Height
        <input data-selection-field="height" type="number" min="${MIN_RECT_SIZE}" max="${state.course.height}" step="${coordinateStep}" value="${entity.height}">
      </label>
    </div>
    <div class="course-editor-actions-row">
      <button id="duplicate-selected-btn" type="button" class="secondary">Duplicate selected</button>
      <button id="delete-selected-btn" type="button" class="ghost-inline">Delete selected</button>
    </div>
  `;
}

function renderExport() {
  elements.exportOutput.value = formatCourseObject(state.course);
}

function drawGridOverlay() {
  if (!state.gridModeEnabled) {
    return;
  }

  const context = renderer.context;
  const minorLineWidth = 1 / Math.max(renderer.worldScale, 1);
  const majorLineWidth = 1.6 / Math.max(renderer.worldScale, 1);

  for (let x = GRID_SNAP_STEP; x < state.course.width; x += GRID_SNAP_STEP) {
    const majorLine = x % GRID_MAJOR_STEP === 0;
    context.beginPath();
    context.strokeStyle = majorLine ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.08)";
    context.lineWidth = majorLine ? majorLineWidth : minorLineWidth;
    context.moveTo(x, 0);
    context.lineTo(x, state.course.height);
    context.stroke();
  }

  for (let y = GRID_SNAP_STEP; y < state.course.height; y += GRID_SNAP_STEP) {
    const majorLine = y % GRID_MAJOR_STEP === 0;
    context.beginPath();
    context.strokeStyle = majorLine ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.08)";
    context.lineWidth = majorLine ? majorLineWidth : minorLineWidth;
    context.moveTo(0, y);
    context.lineTo(state.course.width, y);
    context.stroke();
  }
}

function drawSelectionOverlay() {
  const context = renderer.context;
  context.save();
  context.setTransform(
    renderer.devicePixelRatio * renderer.worldScale,
    0,
    0,
    renderer.devicePixelRatio * renderer.worldScale,
    0,
    0
  );

  drawGridOverlay();

  const entity = getSelectedEntity();
  if (entity && state.selectedTarget) {
    context.strokeStyle = "rgba(255, 245, 190, 0.95)";
    context.fillStyle = "rgba(255, 245, 190, 0.12)";
    context.lineWidth = 4;
    context.setLineDash([10, 8]);

    if (state.selectedTarget.type === "tee") {
      context.beginPath();
      context.arc(entity.x, entity.y, 18, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else if (state.selectedTarget.type === "hole") {
      context.beginPath();
      context.arc(entity.x, entity.y, entity.radius + 8, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else {
      context.beginPath();
      context.roundRect(entity.x - 4, entity.y - 4, entity.width + 8, entity.height + 8, 12);
      context.fill();
      context.stroke();
    }
  }

  if (state.interaction?.type === "draw-rect") {
    const preview = normalizeRect(
      {
        x: state.interaction.start.x,
        y: state.interaction.start.y,
        width: state.interaction.current.x - state.interaction.start.x,
        height: state.interaction.current.y - state.interaction.start.y
      },
      state.course.width,
      state.course.height
    );

    if (preview) {
      const color =
        state.interaction.fieldName === "walls"
          ? "rgba(255, 107, 74, 0.95)"
          : state.interaction.fieldName === "sandTraps"
            ? "rgba(255, 214, 102, 0.95)"
            : "rgba(96, 255, 178, 0.95)";

      context.setLineDash([12, 8]);
      context.strokeStyle = color;
      context.fillStyle = color.replace("0.95", "0.18");
      context.lineWidth = 3;
      context.beginPath();
      context.roundRect(preview.x, preview.y, preview.width, preview.height, 12);
      context.fill();
      context.stroke();
    }
  }

  if (state.pointerWorld) {
    context.setLineDash([]);
    context.fillStyle = "rgba(255, 255, 255, 0.75)";
    context.beginPath();
    context.arc(roundCoordinate(state.pointerWorld.x), roundCoordinate(state.pointerWorld.y), 3, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

function drawEditor() {
  elements.canvas.classList.toggle("is-dragging", Boolean(state.interaction));
  renderer.render({
    course: state.course,
    players: [],
    meId: null,
    mePlayer: null,
    preview: null,
    dragAim: null
  });
  drawSelectionOverlay();
}

function render() {
  syncCourseInputs();
  renderToolPalette();
  renderGridToggle();
  renderSelectionPanel();
  renderObjectList();
  renderExport();
  updatePointerLabel();
  elements.courseTemplateSelect.value = state.sourceCourseId ?? "";
  drawEditor();
}

async function fetchCourseCatalog() {
  const response = await fetch(COURSE_API_URL);
  if (!response.ok) {
    throw new Error("Unable to load course catalog.");
  }

  const payload = await response.json();
  if (!Array.isArray(payload.courses)) {
    throw new Error("Course catalog response was invalid.");
  }

  return payload.courses.map(normalizeCourse);
}

function syncTemplateOptions() {
  elements.courseTemplateSelect.innerHTML = [
    `<option value="">Current draft</option>`,
    ...state.catalog.map((course) => `<option value="${course.id}">${course.name}</option>`)
  ].join("");
}

function getCourseTemplateById(courseId) {
  return state.catalog.find((course) => course.id === courseId) ?? state.catalog[0] ?? createBlankCourse();
}

function updateCourseField(fieldName, value) {
  if (fieldName === "id" || fieldName === "name" || fieldName === "description") {
    state.course[fieldName] = value;
    persistDraft();
    renderExport();
    setStatus("Updated course metadata.");
    return;
  }
}

function commitCourseDimension(fieldName, rawValue) {
  const nextValue =
    fieldName === "width"
      ? normalizeStepValue(rawValue, MIN_COURSE_WIDTH, MAX_COURSE_WIDTH, COURSE_DIMENSION_STEP, state.course.width)
      : normalizeStepValue(rawValue, MIN_COURSE_HEIGHT, MAX_COURSE_HEIGHT, COURSE_DIMENSION_STEP, state.course.height);

  if (state.course[fieldName] === nextValue) {
    elements[fieldName === "width" ? "courseWidthInput" : "courseHeightInput"].value = String(nextValue);
    return;
  }

  updateCourse((draft) => {
    draft[fieldName] = nextValue;
  }, "Updated course dimensions.");
}

function updateSelectedField(fieldName, value) {
  if (!state.selectedTarget) {
    return;
  }

  const nextValue =
    state.gridModeEnabled && ["x", "y", "width", "height"].includes(fieldName)
      ? snapCoordinate(value)
      : value;

  updateCourse((draft) => {
    if (state.selectedTarget.type === "tee" || state.selectedTarget.type === "hole") {
      draft[state.selectedTarget.type][fieldName] = nextValue;
      return;
    }

    const collection = draft[state.selectedTarget.type];
    if (!collection?.[state.selectedTarget.index]) {
      return;
    }

    collection[state.selectedTarget.index][fieldName] = nextValue;
  }, `Updated ${describeSelectedTarget().toLowerCase()}.`);
}

function deleteSelectedTarget() {
  const collectionName = getSelectedRectCollectionName();
  if (!collectionName || !state.selectedTarget) {
    return;
  }

  const deletedLabel = describeSelectedTarget();
  const deletedIndex = state.selectedTarget.index;
  updateCourse((draft) => {
    draft[collectionName].splice(deletedIndex, 1);
  }, `${deletedLabel} deleted.`);
  state.selectedTarget = null;
  render();
}

function duplicateSelectedTarget() {
  const collectionName = getSelectedRectCollectionName();
  if (!collectionName || !state.selectedTarget) {
    return;
  }

  const original = getSelectedEntity();
  if (!original) {
    return;
  }

  updateCourse((draft) => {
    const duplicated = clampRectPosition(
      {
        x: original.x + 18,
        y: original.y + 18,
        width: original.width,
        height: original.height
      },
      draft
    );
    draft[collectionName].push(duplicated);
  }, `${describeSelectedTarget()} duplicated.`);

  const nextIndex = state.course[collectionName].length - 1;
  selectTarget({ type: collectionName, index: nextIndex });
}

function flashButtonLabel(button, temporaryLabel, durationMs = COPY_BUTTON_FEEDBACK_MS) {
  if (!button) {
    return;
  }

  const defaultLabel = button.dataset.defaultLabel || button.textContent.trim();
  button.dataset.defaultLabel = defaultLabel;

  const activeTimer = copyButtonTimers.get(button);
  if (activeTimer) {
    clearTimeout(activeTimer);
  }

  button.textContent = temporaryLabel;
  const resetTimer = window.setTimeout(() => {
    button.textContent = button.dataset.defaultLabel || defaultLabel;
    copyButtonTimers.delete(button);
  }, durationMs);
  copyButtonTimers.set(button, resetTimer);
}

async function copyText(button, text) {
  try {
    await navigator.clipboard.writeText(text);
    flashButtonLabel(button, "Copied!");
  } catch {
    setStatus("Copy failed. Your browser blocked clipboard access.");
  }
}

function downloadCurrentCourseJson() {
  const blob = new Blob([JSON.stringify(state.course, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.course.id || "course"}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  setStatus("Downloaded course JSON.");
}

function loadCourseFromImport() {
  const raw = elements.importInput.value.trim();
  if (!raw) {
    setStatus("Paste a course JSON object first.");
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    const candidate = Array.isArray(parsed) ? parsed[0] : parsed.courses?.[0] ?? parsed.course ?? parsed;
    loadCourse(candidate, {
      markAsSource: false,
      nextStatusMessage: "Imported course draft."
    });
  } catch {
    setStatus("Import failed. Paste valid JSON for a single course object.");
  }
}

function startRectDraw(event, toolId, point) {
  event.preventDefault();
  state.interaction = {
    type: "draw-rect",
    pointerId: event.pointerId,
    fieldName: RECT_TOOL_TO_FIELD[toolId],
    start: point,
    current: point
  };
  elements.canvas.setPointerCapture?.(event.pointerId);
  drawEditor();
}

function startSelectDrag(event, target, point) {
  if (!target) {
    state.selectedTarget = null;
    render();
    return;
  }

  selectTarget(target);
  event.preventDefault();
  if (target.type === "tee" || target.type === "hole") {
    const entity = target.type === "tee" ? state.course.tee : state.course.hole;
    state.interaction = {
      type: "move-point",
      pointerId: event.pointerId,
      target,
      moved: false,
      offsetX: point.x - entity.x,
      offsetY: point.y - entity.y
    };
  } else {
    const rect = state.course[target.type][target.index];
    state.interaction = {
      type: "move-rect",
      pointerId: event.pointerId,
      target,
      moved: false,
      offsetX: point.x - rect.x,
      offsetY: point.y - rect.y
    };
  }

  elements.canvas.setPointerCapture?.(event.pointerId);
}

function commitInteractionMove(point) {
  if (!state.interaction) {
    return;
  }

  state.interaction.moved = true;
  updateCourse((draft) => {
    if (state.interaction.type === "move-point") {
      const targetName = state.interaction.target.type;
      const padding = targetName === "hole" ? draft.hole.radius : 14;
      draft[targetName].x = clamp(roundCoordinate(point.x - state.interaction.offsetX), padding, draft.width - padding);
      draft[targetName].y = clamp(roundCoordinate(point.y - state.interaction.offsetY), padding, draft.height - padding);
      return;
    }

    if (state.interaction.type === "move-rect") {
      const collection = draft[state.interaction.target.type];
      const rect = collection?.[state.interaction.target.index];
      if (!rect) {
        return;
      }

      rect.x = clamp(roundCoordinate(point.x - state.interaction.offsetX), 0, draft.width - rect.width);
      rect.y = clamp(roundCoordinate(point.y - state.interaction.offsetY), 0, draft.height - rect.height);
    }
  }, null, { persist: false, fullRender: false });
}

function finishRectDraw() {
  const interaction = state.interaction;
  if (!interaction || interaction.type !== "draw-rect") {
    return;
  }

  const preview = normalizeRect(
    {
      x: interaction.start.x,
      y: interaction.start.y,
      width: interaction.current.x - interaction.start.x,
      height: interaction.current.y - interaction.start.y
    },
    state.course.width,
    state.course.height
  );

  if (!preview) {
    setStatus("Drag farther to create a larger rectangle.");
    return;
  }

  updateCourse((draft) => {
    draft[interaction.fieldName].push(preview);
  }, `${RECT_FIELD_LABELS[interaction.fieldName]} added.`);
  const nextIndex = state.course[interaction.fieldName].length - 1;
  selectTarget({ type: interaction.fieldName, index: nextIndex });
}

function clearInteraction(pointerId = null) {
  if (pointerId !== null) {
    elements.canvas.releasePointerCapture?.(pointerId);
  }
  state.interaction = null;
  drawEditor();
}

function onCanvasPointerDown(event) {
  if (event.button !== 0) {
    return;
  }

  const point = getWorldPoint(event);
  state.pointerWorld = point;
  updatePointerLabel();

  if (state.selectedTool === "tee") {
    updateCourse((draft) => {
      draft.tee.x = point.x;
      draft.tee.y = point.y;
    }, "Moved tee.");
    selectTarget({ type: "tee" });
    return;
  }

  if (state.selectedTool === "hole") {
    updateCourse((draft) => {
      draft.hole.x = point.x;
      draft.hole.y = point.y;
    }, "Moved hole.");
    selectTarget({ type: "hole" });
    return;
  }

  if (state.selectedTool === "select") {
    startSelectDrag(event, hitTest(point), point);
    return;
  }

  startRectDraw(event, state.selectedTool, point);
}

function onCanvasPointerMove(event) {
  const point = getWorldPoint(event);
  state.pointerWorld = point;
  updatePointerLabel();

  if (!state.interaction || state.interaction.pointerId !== event.pointerId) {
    return;
  }

  if (state.interaction.type === "draw-rect") {
    state.interaction.current = point;
    drawEditor();
    return;
  }

  commitInteractionMove(point);
}

function onCanvasPointerUp(event) {
  const interaction = state.interaction;
  const point = getWorldPoint(event);
  state.pointerWorld = point;
  updatePointerLabel();

  if (!interaction || interaction.pointerId !== event.pointerId) {
    return;
  }

  if (interaction.type === "draw-rect") {
    state.interaction.current = point;
    finishRectDraw();
  } else if (interaction.moved) {
    persistDraft();
    render();
    setStatus(`${describeSelectedTarget()} moved.`);
  }

  clearInteraction(event.pointerId);
}

function onCanvasPointerCancel(event) {
  if (!state.interaction || state.interaction.pointerId !== event.pointerId) {
    return;
  }

  clearInteraction(event.pointerId);
  setStatus("Canceled current editor gesture.");
}

function onCanvasPointerLeave() {
  state.pointerWorld = null;
  updatePointerLabel();
  if (!state.interaction) {
    drawEditor();
  }
}

function onToolbarClick(event) {
  const button = event.target.closest("[data-tool]");
  if (!button) {
    return;
  }

  const toolId = button.dataset.tool;
  if (!TOOL_DEFINITIONS.some((tool) => tool.id === toolId)) {
    return;
  }

  state.selectedTool = toolId;
  renderToolPalette();
  drawEditor();
}

function onObjectListClick(event) {
  const button = event.target.closest("[data-target-type]");
  if (!button) {
    return;
  }

  const target = {
    type: button.dataset.targetType
  };
  if (button.dataset.targetIndex !== undefined) {
    target.index = Number(button.dataset.targetIndex);
  }
  selectTarget(target);
}

function onSelectionPanelInput(event) {
  const input = event.target.closest("[data-selection-field]");
  if (!input) {
    return;
  }

  updateSelectedField(input.dataset.selectionField, Number(input.value));
}

function onSelectionPanelClick(event) {
  if (event.target.id === "delete-selected-btn") {
    deleteSelectedTarget();
    return;
  }

  if (event.target.id === "duplicate-selected-btn") {
    duplicateSelectedTarget();
  }
}

function onCourseFieldInput(event) {
  const input = event.target;
  switch (input.id) {
    case "course-id-input":
      updateCourseField("id", input.value);
      break;
    case "course-name-input":
      updateCourseField("name", input.value);
      break;
    case "course-description-input":
      updateCourseField("description", input.value);
      break;
    default:
      break;
  }
}

function onCourseDimensionCommit(event) {
  const input = event.target;
  if (input.id === "course-width-input") {
    commitCourseDimension("width", input.value);
    return;
  }

  if (input.id === "course-height-input") {
    commitCourseDimension("height", input.value);
  }
}

function onCourseDimensionKeyDown(event) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  onCourseDimensionCommit(event);
  event.target.blur();
}

function onToggleColorMode() {
  state.colorMode = state.colorMode === "dark" ? "light" : "dark";
  saveStoredColorMode();
  applyColorMode();
}

function onToggleGridMode() {
  state.gridModeEnabled = !state.gridModeEnabled;
  saveStorage(GRID_MODE_KEY, state.gridModeEnabled);
  if (state.pointerWorld) {
    state.pointerWorld = state.gridModeEnabled ? snapPoint(state.pointerWorld, state.course) : {
      x: clamp(roundCoordinate(state.pointerWorld.x), 0, state.course.width),
      y: clamp(roundCoordinate(state.pointerWorld.y), 0, state.course.height)
    };
  }
  render();
  setStatus(state.gridModeEnabled ? `Grid snapping enabled at ${GRID_SNAP_STEP} units.` : "Grid snapping disabled.");
}

function onWindowKeyDown(event) {
  if (isEditableElement(event.target)) {
    return;
  }

  const shortcutTool = TOOL_SHORTCUTS.get(event.key.toLowerCase());
  if (shortcutTool) {
    event.preventDefault();
    state.selectedTool = shortcutTool;
    renderToolPalette();
    drawEditor();
    setStatus(`Switched to ${getToolDefinition(shortcutTool).label.toLowerCase()} tool.`);
    return;
  }

  if (event.key.toLowerCase() === "g") {
    event.preventDefault();
    onToggleGridMode();
    return;
  }

  if ((event.key === "Delete" || event.key === "Backspace") && getSelectedRectCollectionName()) {
    event.preventDefault();
    deleteSelectedTarget();
  }
}

function bindElements() {
  elements = {
    themeToggleButton: document.getElementById("page-theme-toggle-btn"),
    courseTemplateSelect: document.getElementById("course-template-select"),
    loadCourseButton: document.getElementById("load-course-btn"),
    newCourseButton: document.getElementById("new-course-btn"),
    duplicateCourseButton: document.getElementById("duplicate-course-btn"),
    gridToggleButton: document.getElementById("grid-toggle-btn"),
    resetCourseButton: document.getElementById("reset-course-btn"),
    toolPalette: document.getElementById("tool-palette"),
    canvas: document.getElementById("course-editor-canvas"),
    editorStatus: document.getElementById("editor-status"),
    editorPointer: document.getElementById("editor-pointer"),
    courseIdInput: document.getElementById("course-id-input"),
    courseNameInput: document.getElementById("course-name-input"),
    courseDescriptionInput: document.getElementById("course-description-input"),
    courseWidthInput: document.getElementById("course-width-input"),
    courseHeightInput: document.getElementById("course-height-input"),
    selectionTitle: document.getElementById("selection-title"),
    selectionPanel: document.getElementById("selection-panel"),
    objectList: document.getElementById("object-list"),
    copyObjectButton: document.getElementById("copy-object-btn"),
    copyJsonButton: document.getElementById("copy-json-btn"),
    downloadJsonButton: document.getElementById("download-json-btn"),
    exportOutput: document.getElementById("export-output"),
    importInput: document.getElementById("import-input"),
    importJsonButton: document.getElementById("import-json-btn")
  };
}

function bindEvents() {
  elements.themeToggleButton.addEventListener("click", onToggleColorMode);
  elements.toolPalette.addEventListener("click", onToolbarClick);
  elements.canvas.addEventListener("pointerdown", onCanvasPointerDown);
  elements.canvas.addEventListener("pointermove", onCanvasPointerMove);
  elements.canvas.addEventListener("pointerup", onCanvasPointerUp);
  elements.canvas.addEventListener("pointercancel", onCanvasPointerCancel);
  elements.canvas.addEventListener("pointerleave", onCanvasPointerLeave);

  elements.loadCourseButton.addEventListener("click", () => {
    if (!elements.courseTemplateSelect.value) {
      setStatus("Choose an existing course to load.");
      return;
    }

    const course = getCourseTemplateById(elements.courseTemplateSelect.value);
    loadCourse(course, { markAsSource: true, nextStatusMessage: `Loaded ${course.name}.` });
  });

  elements.newCourseButton.addEventListener("click", () => {
    state.sourceCourseId = null;
    loadCourse(createBlankCourse(), {
      markAsSource: false,
      nextStatusMessage: "Started a blank course."
    });
  });

  elements.duplicateCourseButton.addEventListener("click", () => {
    state.sourceCourseId = null;
    loadCourse(copyCurrentCourse(`${state.course.id}-copy`), {
      markAsSource: false,
      nextStatusMessage: "Duplicated current draft."
    });
  });

  elements.resetCourseButton.addEventListener("click", () => {
    if (state.sourceCourseId) {
      const sourceCourse = getCourseTemplateById(state.sourceCourseId);
      loadCourse(sourceCourse, {
        markAsSource: true,
        nextStatusMessage: `Reset draft back to ${sourceCourse.name}.`
      });
      return;
    }

    loadCourse(createBlankCourse(), {
      markAsSource: false,
      nextStatusMessage: "Reset draft back to a blank course."
    });
  });
  elements.gridToggleButton.addEventListener("click", onToggleGridMode);

  [
    elements.courseIdInput,
    elements.courseNameInput,
    elements.courseDescriptionInput
  ].forEach((input) => input.addEventListener("input", onCourseFieldInput));

  [elements.courseWidthInput, elements.courseHeightInput].forEach((input) => {
    input.addEventListener("change", onCourseDimensionCommit);
    input.addEventListener("blur", onCourseDimensionCommit);
    input.addEventListener("keydown", onCourseDimensionKeyDown);
  });

  elements.selectionPanel.addEventListener("input", onSelectionPanelInput);
  elements.selectionPanel.addEventListener("click", onSelectionPanelClick);
  elements.objectList.addEventListener("click", onObjectListClick);

  elements.copyObjectButton.addEventListener("click", () => {
    void copyText(elements.copyObjectButton, formatCourseObject(state.course));
  });
  elements.copyJsonButton.addEventListener("click", () => {
    void copyText(elements.copyJsonButton, JSON.stringify(state.course, null, 2));
  });
  elements.downloadJsonButton.addEventListener("click", downloadCurrentCourseJson);
  elements.importJsonButton.addEventListener("click", loadCourseFromImport);

  window.addEventListener("keydown", onWindowKeyDown);
  window.addEventListener("resize", () => drawEditor());
}

async function initialize() {
  bindElements();
  bindEvents();
  applyColorMode();
  renderer = new CourseRenderer(elements.canvas);

  try {
    state.catalog = await fetchCourseCatalog();
    syncTemplateOptions();
    const storedDraft = loadStoredDraft();
    if (storedDraft) {
      state.sourceCourseId = null;
      loadCourse(storedDraft, {
        markAsSource: false,
        nextStatusMessage: "Restored autosaved course draft."
      });
      return;
    }

    loadCourse(createBlankCourse(), {
      markAsSource: false,
      nextStatusMessage: "Started a blank course."
    });
  } catch (error) {
    setStatus(error.message);
  }
}

void initialize();
