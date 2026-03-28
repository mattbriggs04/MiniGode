function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getCourseRects(course, fieldName, legacyFieldName = null) {
  if (Array.isArray(course?.[fieldName])) {
    return course[fieldName];
  }

  if (legacyFieldName && Array.isArray(course?.[legacyFieldName])) {
    return course[legacyFieldName];
  }

  return [];
}

function getRectAngleRadians(rect) {
  return ((Number(rect?.angle) || 0) * Math.PI) / 180;
}

function drawRectPath(context, rect, radius = 0) {
  const angle = getRectAngleRadians(rect);
  context.save();
  context.translate(rect.x, rect.y);
  if (angle) {
    context.rotate(angle);
  }
  context.beginPath();
  if (radius > 0) {
    context.roundRect(0, 0, rect.width, rect.height, radius);
  } else {
    context.rect(0, 0, rect.width, rect.height);
  }
  context.restore();
}

function fillCourseRects(context, rects, radius = 0) {
  rects.forEach((rect) => {
    drawRectPath(context, rect, radius);
    context.fill();
  });
}

function drawSpeedBoosts(context, boosts) {
  boosts.forEach((boost) => {
    const strength = Math.min(3, Math.max(1, Math.round(Number(boost.strength) || 1)));
    const boostLabel = ">".repeat(strength);
    const fillColors = ["#7ed957", "#f6c453", "#ff8b63"];
    const fillStyle = fillColors[strength - 1];
    const angle = getRectAngleRadians(boost);

    context.save();
    context.translate(boost.x, boost.y);
    if (angle) {
      context.rotate(angle);
    }

    context.fillStyle = fillStyle;
    context.fillRect(0, 0, boost.width, boost.height);
    context.strokeStyle = "rgba(255, 255, 255, 0.72)";
    context.lineWidth = 2;
    context.strokeRect(0, 0, boost.width, boost.height);

    let fontSize = Math.min(boost.height * 0.72, boost.width / Math.max(1.4, strength * 0.72));
    fontSize = clamp(fontSize, 12, 44);
    context.fillStyle = "rgba(12, 24, 18, 0.82)";
    context.textAlign = "center";
    context.textBaseline = "middle";

    while (fontSize >= 12) {
      context.font = `900 ${fontSize}px 'IBM Plex Mono', 'Avenir Next', sans-serif`;
      if (context.measureText(boostLabel).width <= boost.width - 12) {
        break;
      }
      fontSize -= 2;
    }

    context.fillText(boostLabel, boost.width / 2, boost.height / 2 + fontSize * 0.04);

    context.restore();
  });
}

function interpolatePoint(path, progress) {
  if (!path?.length) {
    return null;
  }

  if (path.length === 1) {
    return path[0];
  }

  const scaled = progress * (path.length - 1);
  const index = Math.floor(scaled);
  const nextIndex = Math.min(path.length - 1, index + 1);
  const segmentProgress = scaled - index;
  const start = path[index];
  const end = path[nextIndex];

  return {
    x: start.x + (end.x - start.x) * segmentProgress,
    y: start.y + (end.y - start.y) * segmentProgress
  };
}

export class CourseRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.devicePixelRatio = window.devicePixelRatio || 1;
    this.lastDevicePixelRatio = this.devicePixelRatio;
    this.lastScene = null;
    this.animation = null;
    this.animationQueue = [];
    this.lastDisplayWidth = 0;
    this.lastDisplayHeight = 0;
    this.worldScale = 1;

    window.addEventListener("resize", () => {
      if (this.lastScene) {
        this.render(this.lastScene);
      }
    });

    window.visualViewport?.addEventListener("resize", () => {
      if (this.lastScene) {
        this.render(this.lastScene);
      }
    });
  }

  getStage() {
    const parent = this.canvas.parentElement;
    if (!parent?.classList?.contains("golf-canvas-stage")) {
      return null;
    }

    return parent;
  }

  getFrame() {
    return this.canvas.closest(".golf-canvas-shell, .course-editor-canvas-shell") ?? this.canvas.parentElement;
  }

  resize(course, zoom = 1) {
    const stage = this.getStage();
    const frame = this.getFrame();
    const availableWidth = Math.floor(frame.clientWidth);
    const availableHeight = Math.floor(frame.clientHeight || course.height);

    if (!availableWidth || !availableHeight) {
      return false;
    }

    this.devicePixelRatio = window.devicePixelRatio || 1;
    const fitScale = Math.min(1, Math.max(availableWidth / course.width, availableHeight / course.height));
    const scale = fitScale * Math.max(0.1, Number(zoom) || 1);
    const displayWidth = Math.max(1, Math.round(course.width * scale));
    const displayHeight = Math.max(1, Math.round(course.height * scale));
    const devicePixelRatioChanged = Math.abs(this.devicePixelRatio - this.lastDevicePixelRatio) > 0.001;

    if (displayWidth !== this.lastDisplayWidth || displayHeight !== this.lastDisplayHeight || devicePixelRatioChanged) {
      this.canvas.style.width = `${displayWidth}px`;
      this.canvas.style.height = `${displayHeight}px`;
      this.canvas.width = Math.round(displayWidth * this.devicePixelRatio);
      this.canvas.height = Math.round(displayHeight * this.devicePixelRatio);
      this.lastDisplayWidth = displayWidth;
      this.lastDisplayHeight = displayHeight;
      this.lastDevicePixelRatio = this.devicePixelRatio;
    }

    if (stage && frame) {
      const horizontalSlack = Math.max(availableWidth - displayWidth, 0);
      const verticalSlack = Math.max(availableHeight - displayHeight, 0);
      stage.style.width = `${displayWidth + horizontalSlack * 2}px`;
      stage.style.height = `${displayHeight + verticalSlack * 2}px`;
    }

    this.worldScale = displayWidth / course.width;
    return true;
  }

  screenToWorld(event, course) {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * course.width,
      y: ((event.clientY - bounds.top) / bounds.height) * course.height
    };
  }

  centerOnPoint(point, { smooth = false } = {}) {
    const frame = this.getFrame();
    if (!frame || !point) {
      return;
    }

    const frameBounds = frame.getBoundingClientRect();
    const canvasBounds = this.canvas.getBoundingClientRect();
    const canvasLeft = canvasBounds.left - frameBounds.left + frame.scrollLeft;
    const canvasTop = canvasBounds.top - frameBounds.top + frame.scrollTop;
    const behavior = smooth ? "smooth" : "auto";
    const targetLeft = canvasLeft + point.x * this.worldScale - frame.clientWidth / 2;
    const targetTop = canvasTop + point.y * this.worldScale - frame.clientHeight / 2;
    frame.scrollTo({
      left: clamp(targetLeft, 0, Math.max(0, frame.scrollWidth - frame.clientWidth)),
      top: clamp(targetTop, 0, Math.max(0, frame.scrollHeight - frame.clientHeight)),
      behavior
    });
  }

  playSwing(path, { playerId = null, onComplete = null } = {}) {
    if (!path?.length) {
      onComplete?.();
      return;
    }

    this.animationQueue.push({
      path,
      playerId,
      onComplete
    });

    if (this.animation) {
      return;
    }

    this.startNextAnimation();
  }

  startNextAnimation() {
    const nextAnimation = this.animationQueue.shift();
    if (!nextAnimation) {
      return;
    }

    this.animation = {
      startedAt: performance.now(),
      duration: Math.max(800, nextAnimation.path.length * 24),
      path: nextAnimation.path,
      playerId: nextAnimation.playerId,
      onComplete: nextAnimation.onComplete
    };

    const tick = (now) => {
      if (!this.animation) {
        return;
      }

      this.render(this.lastScene, now);
      if (now - this.animation.startedAt < this.animation.duration) {
        requestAnimationFrame(tick);
      } else {
        const completedAnimation = this.animation;
        this.animation = null;
        this.render(this.lastScene);
        completedAnimation?.onComplete?.();
        this.startNextAnimation();
      }
    };

    requestAnimationFrame(tick);
  }

  drawCourse(course) {
    const context = this.context;
    const accents = getCourseRects(course, "accents");
    const sandTraps = getCourseRects(course, "sandTraps");
    const waterHazards = getCourseRects(course, "waterHazards", "water");
    const walls = getCourseRects(course, "walls");
    const speedBoosts = getCourseRects(course, "speedBoosts");
    const gradient = context.createLinearGradient(0, 0, course.width, course.height);
    gradient.addColorStop(0, "#5b9a62");
    gradient.addColorStop(1, "#437a4b");
    context.fillStyle = gradient;
    context.fillRect(0, 0, course.width, course.height);

    context.fillStyle = "rgba(255, 255, 255, 0.08)";
    fillCourseRects(context, accents, 22);

    context.fillStyle = "#2e82d1";
    fillCourseRects(context, waterHazards, 28);

    context.fillStyle = "#d7b267";
    fillCourseRects(context, sandTraps, 28);

    context.fillStyle = "#e5e8ec";
    fillCourseRects(context, walls, 0);

    drawSpeedBoosts(context, speedBoosts);

    context.fillStyle = "#111111";
    context.beginPath();
    context.arc(course.hole.x, course.hole.y, course.hole.radius, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = "#f8f1e5";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(course.hole.x, course.hole.y - 46);
    context.lineTo(course.hole.x, course.hole.y);
    context.stroke();

    context.fillStyle = "#ff715b";
    context.beginPath();
    context.moveTo(course.hole.x, course.hole.y - 42);
    context.lineTo(course.hole.x + 28, course.hole.y - 32);
    context.lineTo(course.hole.x, course.hole.y - 20);
    context.closePath();
    context.fill();

    context.strokeStyle = "rgba(255, 255, 255, 0.68)";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(course.tee.x, course.tee.y, 12, 0, Math.PI * 2);
    context.stroke();
  }

  drawPreview(scene) {
    if (!scene.preview || !scene.mePlayer || scene.mePlayer.ball.sunk) {
      return;
    }

    const distance = scene.preview.power * 220;
    const target = {
      x: scene.mePlayer.ball.x + Math.cos(scene.preview.angle) * distance,
      y: scene.mePlayer.ball.y + Math.sin(scene.preview.angle) * distance
    };
    const context = this.context;

    context.save();
    if (scene.dragAim?.current) {
      context.strokeStyle = "rgba(255, 184, 77, 0.95)";
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(scene.mePlayer.ball.x, scene.mePlayer.ball.y);
      context.lineTo(scene.dragAim.current.x, scene.dragAim.current.y);
      context.stroke();

      context.fillStyle = "rgba(255, 184, 77, 0.95)";
      context.beginPath();
      context.arc(scene.dragAim.current.x, scene.dragAim.current.y, 6, 0, Math.PI * 2);
      context.fill();
    }

    context.strokeStyle = "rgba(255, 245, 190, 0.9)";
    context.lineWidth = 3;
    context.setLineDash([10, 8]);
    context.beginPath();
    context.moveTo(scene.mePlayer.ball.x, scene.mePlayer.ball.y);
    context.lineTo(target.x, target.y);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(255, 245, 190, 0.95)";
    context.beginPath();
    context.arc(target.x, target.y, 6, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  drawPlayers(scene, now = performance.now()) {
    const context = this.context;
    const animationProgress = this.animation
      ? clamp((now - this.animation.startedAt) / this.animation.duration, 0, 1)
      : 0;
    const animatedPoint = this.animation ? interpolatePoint(this.animation.path, animationProgress) : null;

    scene.players.forEach((player) => {
      const showingAnimatedBall = player.id === this.animation?.playerId && Boolean(animatedPoint);

      const ball =
        showingAnimatedBall
          ? { ...player.ball, ...animatedPoint }
          : player.ball.sunk
            ? { ...player.ball, x: scene.course.hole.x, y: scene.course.hole.y }
            : player.ball;

      context.fillStyle = player.color;
      context.beginPath();
      context.arc(ball.x, ball.y, 11, 0, Math.PI * 2);
      context.fill();

      context.lineWidth = 3;
      context.strokeStyle = player.id === scene.meId ? "#f8f1e5" : "rgba(248, 241, 229, 0.45)";
      context.stroke();

      if (player.ball.sunk && !showingAnimatedBall) {
        context.beginPath();
        context.strokeStyle = "rgba(255, 255, 255, 0.92)";
        context.lineWidth = 2;
        context.arc(ball.x, ball.y, 15, 0, Math.PI * 2);
        context.stroke();
      }

      context.fillStyle = "rgba(255, 255, 255, 0.92)";
      context.font = "bold 14px 'IBM Plex Sans', 'Avenir Next', sans-serif";
      context.fillText(player.name.slice(0, 10), ball.x + 15, ball.y - 14);
    });
  }

  render(scene, now) {
    if (!scene?.course || !this.resize(scene.course, scene.zoom)) {
      return;
    }

    this.lastScene = scene;
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.setTransform(
      this.devicePixelRatio * this.worldScale,
      0,
      0,
      this.devicePixelRatio * this.worldScale,
      0,
      0
    );
    this.drawCourse(scene.course);
    this.drawPreview(scene);
    this.drawPlayers(scene, now);
  }
}
