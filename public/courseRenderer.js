function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
    this.lastScene = null;
    this.animation = null;
    this.lastDisplayWidth = 0;
    this.lastDisplayHeight = 0;
    this.worldScale = 1;

    window.addEventListener("resize", () => {
      if (this.lastScene) {
        this.render(this.lastScene);
      }
    });
  }

  resize(course) {
    const frame = this.canvas.parentElement;
    const availableWidth = Math.floor(frame.clientWidth);

    if (!availableWidth) {
      return false;
    }

    this.devicePixelRatio = window.devicePixelRatio || 1;
    const displayWidth = Math.min(availableWidth, course.width);
    const displayHeight = Math.round(displayWidth * (course.height / course.width));

    if (displayWidth !== this.lastDisplayWidth || displayHeight !== this.lastDisplayHeight) {
      this.canvas.style.width = `${displayWidth}px`;
      this.canvas.style.height = `${displayHeight}px`;
      this.canvas.width = Math.round(displayWidth * this.devicePixelRatio);
      this.canvas.height = Math.round(displayHeight * this.devicePixelRatio);
      this.lastDisplayWidth = displayWidth;
      this.lastDisplayHeight = displayHeight;
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

  playSwing(path) {
    if (!path?.length) {
      return;
    }

    this.animation = {
      startedAt: performance.now(),
      duration: Math.max(800, path.length * 24),
      path
    };

    const tick = (now) => {
      if (!this.animation) {
        return;
      }

      this.render(this.lastScene, now);
      if (now - this.animation.startedAt < this.animation.duration) {
        requestAnimationFrame(tick);
      } else {
        this.animation = null;
        this.render(this.lastScene);
      }
    };

    requestAnimationFrame(tick);
  }

  drawCourse(course) {
    const context = this.context;
    const gradient = context.createLinearGradient(0, 0, course.width, course.height);
    gradient.addColorStop(0, "#183a2d");
    gradient.addColorStop(1, "#0f271d");
    context.fillStyle = gradient;
    context.fillRect(0, 0, course.width, course.height);

    context.fillStyle = "#4f8a58";
    context.fillRect(18, 18, course.width - 36, course.height - 36);

    context.fillStyle = "rgba(255, 255, 255, 0.08)";
    course.accents.forEach((accent) => {
      context.beginPath();
      context.roundRect(accent.x, accent.y, accent.width, accent.height, 22);
      context.fill();
    });

    context.fillStyle = "#d7b267";
    course.sandTraps.forEach((trap) => {
      context.beginPath();
      context.roundRect(trap.x, trap.y, trap.width, trap.height, 28);
      context.fill();
    });

    context.fillStyle = "#5d3a1a";
    course.walls.forEach((wall) => {
      context.beginPath();
      context.roundRect(wall.x, wall.y, wall.width, wall.height, 12);
      context.fill();
    });

    context.strokeStyle = "rgba(255, 255, 255, 0.2)";
    context.lineWidth = 4;
    context.strokeRect(18, 18, course.width - 36, course.height - 36);

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
      const ball =
        player.id === scene.meId && animatedPoint
          ? { ...player.ball, ...animatedPoint }
          : player.ball;

      context.fillStyle = player.color;
      context.beginPath();
      context.arc(ball.x, ball.y, 11, 0, Math.PI * 2);
      context.fill();

      context.lineWidth = 3;
      context.strokeStyle = player.id === scene.meId ? "#f8f1e5" : "rgba(248, 241, 229, 0.45)";
      context.stroke();

      context.fillStyle = "rgba(255, 255, 255, 0.92)";
      context.font = "bold 14px 'IBM Plex Sans', 'Avenir Next', sans-serif";
      context.fillText(player.name.slice(0, 10), ball.x + 15, ball.y - 14);

      if (player.ball.sunk) {
        context.fillStyle = "rgba(255, 255, 255, 0.8)";
        context.font = "600 13px 'IBM Plex Sans', 'Avenir Next', sans-serif";
        context.fillText("Finished", ball.x + 15, ball.y + 6);
      }
    });
  }

  render(scene, now) {
    if (!scene?.course || !this.resize(scene.course)) {
      return;
    }

    this.lastScene = scene;
    this.context.setTransform(
      this.devicePixelRatio * this.worldScale,
      0,
      0,
      this.devicePixelRatio * this.worldScale,
      0,
      0
    );
    this.context.clearRect(0, 0, scene.course.width, scene.course.height);
    this.drawCourse(scene.course);
    this.drawPreview(scene);
    this.drawPlayers(scene, now);
  }
}
