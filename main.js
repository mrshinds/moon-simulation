import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import SunCalc from 'suncalc';
import solarlunar from 'solarlunar';

// --- Constants ---
const SCENE_SCALE = 1;
const EARTH_RADIUS = 2.5 * SCENE_SCALE;
const MOON_RADIUS = 0.7 * SCENE_SCALE;
const SUN_RADIUS = 12 * SCENE_SCALE; // Made Sun significantly larger to be visible at distance
const EARTH_SUN_DIST = 60 * SCENE_SCALE; // Increased distance slightly to accommodate larger sun
const EARTH_MOON_DIST = 10 * SCENE_SCALE;

// --- Globals ---
let scene, camera, renderer, labelRenderer;
let phaseScene, phaseCamera, phaseRenderer, phaseMoonMesh, phaseLight;
let sunMesh, earthMesh, moonMesh, moonOrbitPivot, earthOrbitPivot;
let bgMesh, stars;
let sunLine, earthMoonLine; // New Guide Lines
let currentDate = new Date();
let clock = new THREE.Clock();

// Simulation State
let timeScale = 1;
let isPaused = false;

// DOM Elements
const canvasContainer = document.getElementById('canvas-container');
const phaseCanvas = document.getElementById('phase-canvas');
const phaseNameEl = document.getElementById('phase-name');
const pauseBtn = document.getElementById('pause-btn');
const speedSlider = document.getElementById('speed-slider');
const dateInput = document.getElementById('date-input');
const setDateBtn = document.getElementById('set-date-btn');

function init() {
    // 1. Setup Main Scene
    scene = new THREE.Scene();

    // Main Camera
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 2000); // Lower FOV for more "cinematic" look
    camera.position.set(0, 60, 180); // Raised Y to 60 to clear Sun occlusion (calculated min 48)
    camera.lookAt(0, 0, 0);

    // Main Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // Alpha true for CSS background
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Transparent background to let CSS show through
    renderer.setClearColor(0x000000, 0);
    canvasContainer.appendChild(renderer.domElement);

    // Label Renderer
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none'; // Click through
    canvasContainer.appendChild(labelRenderer.domElement);

    // 2. Setup Phase View (Isolated Scene)
    initPhaseScene();

    // 3. Lighting (Main Scene)
    const ambientLight = new THREE.AmbientLight(0x333333);
    scene.add(ambientLight);

    const sunLight = new THREE.PointLight(0xffffff, 5, 1000, 0);
    sunLight.position.set(0, 0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048; // Higher res shadows
    sunLight.shadow.mapSize.height = 2048;
    scene.add(sunLight);

    // 4. Objects
    createObjects();

    // 5. Events
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', (e) => {
        // Ignore if typing in an input
        if (e.target.tagName === 'INPUT') return;

        if (e.code === 'Space') {
            e.preventDefault(); // Stop page scroll
            // If focus is on button, browser handles click. 
            // We ignore keydown here if target matches our button to avoid double-toggle
            if (e.target === pauseBtn) return;

            togglePause();
        }
    });

    setupUI();

    // Initial State
    dateInput.valueAsDate = currentDate;
    updateSimulationFromDate(currentDate);

    // Start Loop
    // Start Loop
    animate();
}

function initPhaseScene() {
    // Separate scene for just the moon phase
    phaseScene = new THREE.Scene();
    phaseScene.background = new THREE.Color(0x000000);

    // Camera looking at the moon
    phaseCamera = new THREE.PerspectiveCamera(25, 1, 0.1, 100);
    phaseCamera.position.set(0, 0, 5); // Look at moon from z=5

    // Renderer
    phaseRenderer = new THREE.WebGLRenderer({ canvas: phaseCanvas, antialias: true, alpha: true });
    phaseRenderer.setSize(280, 280);
    phaseRenderer.setPixelRatio(window.devicePixelRatio);

    // Moon Mesh for Phase View
    const textureLoader = new THREE.TextureLoader();
    const moonGeo = new THREE.SphereGeometry(1, 64, 64);
    const moonMat = new THREE.MeshStandardMaterial({
        map: textureLoader.load('/moon.jpg'),
        roughness: 0.9,
        metalness: 0
    });
    phaseMoonMesh = new THREE.Mesh(moonGeo, moonMat);
    phaseScene.add(phaseMoonMesh);

    // Lighting for Phase View
    // We will rotate this light around the moon to simulate phases
    // Phase 0 (New Moon) = Light behind moon (180 deg)
    // Phase 0.5 (Full Moon) = Light front of moon (0 deg)
    phaseLight = new THREE.DirectionalLight(0xffffff, 3);
    phaseScene.add(phaseLight);

    // Ambient for earthshine
    const phaseAmbient = new THREE.AmbientLight(0x111111);
    phaseScene.add(phaseAmbient);
}

const textureLoader = new THREE.TextureLoader();

function createObjects() {
    // Stars Background handled by CSS for max resolution
    // scene.background = ... removed

    // Sun
    const sunGeo = new THREE.SphereGeometry(SUN_RADIUS, 64, 64);
    const sunMat = new THREE.MeshBasicMaterial({
        map: textureLoader.load('/sun.jpg')
    });
    sunMesh = new THREE.Mesh(sunGeo, sunMat);
    scene.add(sunMesh);
    addLabel(sunMesh, '태양 (Sun)', SUN_RADIUS + 2);

    // Guide Lines (Sun -> Earth)
    const sunLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)]);
    const sunLineMat = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.3 });
    sunLine = new THREE.Line(sunLineGeo, sunLineMat);
    scene.add(sunLine);

    // Guide Line (Earth -> Moon)
    const emLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)]);
    const emLineMat = new THREE.LineBasicMaterial({ color: 0x8888ff, transparent: true, opacity: 0.5 });
    earthMoonLine = new THREE.Line(emLineGeo, emLineMat);
    scene.add(earthMoonLine);

    // Pivots
    earthOrbitPivot = new THREE.Object3D();
    scene.add(earthOrbitPivot);

    const earthGroup = new THREE.Object3D();
    earthGroup.position.set(EARTH_SUN_DIST, 0, 0);
    earthOrbitPivot.add(earthGroup);

    // Earth Tilt Group (Handles 23.5 degree tilt)
    const earthTiltGroup = new THREE.Object3D();
    earthTiltGroup.rotation.z = 23.5 * Math.PI / 180; // Apply tilt to the group
    earthGroup.add(earthTiltGroup);

    // Earth (Spins around Y axis of the Tilted Group)
    const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64);
    const earthMat = new THREE.MeshStandardMaterial({
        map: textureLoader.load('/earth.jpg'),
        roughness: 0.5,
        metalness: 0.1
    });
    earthMesh = new THREE.Mesh(earthGeo, earthMat);
    earthMesh.castShadow = false; // Disable shadow casting to prevent monthly lunar eclipses (fake tilt)
    earthMesh.receiveShadow = true;
    earthTiltGroup.add(earthMesh); // Add earth to tilt group
    addLabel(earthMesh, '지구 (Earth)', EARTH_RADIUS + 2);

    // Moon Inclination Group (Handles 5.14 degree orbital tilt)
    const moonInclinationGroup = new THREE.Object3D();
    moonInclinationGroup.rotation.z = -5.14 * Math.PI / 180; // Tilt relative to Ecliptic
    // We tilt around Z so that at Phase 0/0.5 (X-axis) the moon is Up/Down.
    // This effectively prevents visual alignment (Eclipse).
    earthGroup.add(moonInclinationGroup);

    // Moon Pivot (Rotates Y within the tilted plane)
    moonOrbitPivot = new THREE.Object3D();
    moonInclinationGroup.add(moonOrbitPivot);

    // Moon
    const moonGeo = new THREE.SphereGeometry(MOON_RADIUS, 64, 64);
    const moonMat = new THREE.MeshStandardMaterial({
        map: textureLoader.load('/moon.jpg'),
        roughness: 0.9,
        metalness: 0
    });
    moonMesh = new THREE.Mesh(moonGeo, moonMat);
    moonMesh.castShadow = false; // Disable shadow casting to prevent monthly solar eclipses
    moonMesh.receiveShadow = true;
    moonMesh.position.set(EARTH_MOON_DIST, 0, 0);
    moonOrbitPivot.add(moonMesh);
    addLabel(moonMesh, '달 (Moon)', MOON_RADIUS + 1.5);
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onMouseClick(event) {
    // Calculate mouse position in normalized device coordinates
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check intersection with Sun
    const intersects = raycaster.intersectObject(sunMesh);

    if (intersects.length > 0) {
        toggleSun();
    }
}

let sunOn = true;
function toggleSun() {
    sunOn = !sunOn;
    // Find lights
    const sunLight = scene.getObjectByProperty('type', 'PointLight');
    const ambientLight = scene.getObjectByProperty('type', 'AmbientLight');

    if (sunOn) {
        sunLight.intensity = 5;
        ambientLight.intensity = 1;
        sunMesh.material.color.setHex(0xffffff); // Bright
        addLabel(sunMesh, '태양 (Sun)', SUN_RADIUS + 2); // Restore label if we want logic for that? (Label is separate obj, stays)
    } else {
        sunLight.intensity = 0;
        ambientLight.intensity = 0.1; // Very dim
        sunMesh.material.color.setHex(0x333333); // Dim/Off appearance
    }
}

// Global elements
const orbitSlider = document.getElementById('orbit-slider');

function setupUI() {
    pauseBtn.addEventListener('click', () => {
        togglePause();
        pauseBtn.blur();
    });
    speedSlider.addEventListener('input', (e) => timeScale = parseInt(e.target.value));

    // Orbit Slider (Time Travel)
    orbitSlider.addEventListener('input', (e) => {
        isPaused = true;
        pauseBtn.textContent = '재생';

        const dayVal = parseFloat(e.target.value);
        const startOfYear = new Date(currentDate.getFullYear(), 0, 0);

        // Update current date based on day of year
        currentDate = new Date(startOfYear.getTime() + dayVal * 24 * 60 * 60 * 1000);

        // Sync Date Input
        dateInput.valueAsDate = currentDate;

        updateSimulationFromDate(currentDate);
    });

    setDateBtn.addEventListener('click', () => {
        const dateStr = dateInput.value;
        if (dateStr) {
            currentDate = new Date(dateStr);
            currentDate.setHours(0, 0, 0, 0);
            updateSimulationFromDate(currentDate);
            isPaused = true;
            pauseBtn.textContent = '재생';
        }
    });

    // Sun Switch Click
    window.addEventListener('click', onMouseClick);
}

function togglePause() {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? '재생' : '일시정지';
}

// Throttle UI updates
let lastUiUpdate = 0;

function updateSimulationFromDate(date) {
    // 1. Calculate Phase
    const illumination = SunCalc.getMoonIllumination(date);
    const phase = illumination.phase; // 0 New, 0.5 Full

    // 2. Update UI (throttled)
    const now = Date.now();
    if (now - lastUiUpdate > 500) { // Every 500ms
        updateSimulationInfoThrottled(date, phase);
        lastUiUpdate = now;
    }

    // 3. Update Physics (Positions)
    // Moon visual position relative to Earth
    const moonRotation = Math.PI + (phase * 2 * Math.PI);
    moonOrbitPivot.rotation.y = moonRotation;

    // Earth Season (Orbit around Sun)
    const startOfYear = new Date(date.getFullYear(), 0, 0);
    // Use fractional days for smooth animation
    const dayOfYear = (date - startOfYear) / (1000 * 60 * 60 * 24);

    // Sync Slider
    if (!isPaused) {
        orbitSlider.value = dayOfYear;
    }

    const yearRatio = dayOfYear / 365.25;
    earthOrbitPivot.rotation.y = yearRatio * 2 * Math.PI;

    // Earth Spin
    const hours = date.getHours() + date.getMinutes() / 60;
    earthMesh.rotation.y = (hours / 24) * 2 * Math.PI;

    // 4. Update Phase View (Isolated Scene)
    updatePhaseView(phase);

    // 5. Update Guide Lines
    updateGuideLines();
}

function updateGuideLines() {
    // Sun -> Earth
    // Sun is at 0,0,0. Earth is at earthOrbitPivot.position + rotation offset?
    // Actually simpler: Get world positions.
    // Earth is inside earthOrbitPivot -> earthGroup -> earthMesh
    // Moon is inside earthOrbitPivot -> earthGroup -> moonOrbitPivot -> moonMesh

    // Since we are using a scene graph, obtaining world position is best done via updateMatrixWorld
    // but better to just calculate coordinates if optimization is key. 
    // For now, let's use vectors updated from matrices for accuracy.

    // We can't rely on earthMesh.position because it's local (0,0,0 inside group except for spin?). 
    // Wait, earthMesh is at (0,0,0) inside earthGroup. 
    // earthGroup is at (EARTH_SUN_DIST, 0, 0) inside earthOrbitPivot.

    // We need the world coordinates.
    // Force update of matrices for this frame
    scene.updateMatrixWorld();

    const sunPos = new THREE.Vector3();
    sunMesh.getWorldPosition(sunPos);

    const earthPos = new THREE.Vector3();
    earthMesh.getWorldPosition(earthPos);

    const moonPos = new THREE.Vector3();
    moonMesh.getWorldPosition(moonPos);

    // Sun Line
    const positions1 = sunLine.geometry.attributes.position.array;
    positions1[0] = sunPos.x; positions1[1] = sunPos.y; positions1[2] = sunPos.z;
    positions1[3] = earthPos.x; positions1[4] = earthPos.y; positions1[5] = earthPos.z;
    sunLine.geometry.attributes.position.needsUpdate = true;

    // Earth-Moon Line
    const positions2 = earthMoonLine.geometry.attributes.position.array;
    positions2[0] = earthPos.x; positions2[1] = earthPos.y; positions2[2] = earthPos.z;
    positions2[3] = moonPos.x; positions2[4] = moonPos.y; positions2[5] = moonPos.z;
    earthMoonLine.geometry.attributes.position.needsUpdate = true;
}

function updatePhaseView(phase) {
    // Rotate light based on phase
    // Phase 0 (New) -> Light at 180 deg (behind moon)
    // Phase 0.5 (Full) -> Light at 0 deg (front)

    // We want the light to rotate AROUND the moon.
    // Let's create a vector for light position.

    // Convert phase to angle.
    // lightAngle = 0 is Front.
    // Phase 0.0 (New) => Angle PI (Back)
    // Phase 0.25 (First Q) => Angle PI/2 (Right)
    // Phase 0.5 (Full) => Angle 0 (Front)
    // Phase 0.75 (Last Q) => Angle -PI/2 (Left)

    // SunCalc Phase:
    // 0 = New Moon
    // 0.25 = First Quarter
    // 0.5 = Full Moon
    // 0.75 = Last Quarter

    // Mapping:
    // 0 -> PI
    // 0.25 -> PI/2
    // 0.5 -> 0
    // 0.75 -> -PI/2
    // 1.0 -> -PI

    const angle = Math.PI - (phase * 2 * Math.PI);

    const dist = 10;
    phaseLight.position.x = Math.sin(angle) * dist;
    phaseLight.position.z = Math.cos(angle) * dist;
    phaseLight.position.y = 0;

    phaseLight.lookAt(0, 0, 0);
}

function updateSimulationInfoThrottled(date, phase) {
    const solarYear = date.getFullYear();
    const solarMonth = date.getMonth() + 1;
    const solarDay = date.getDate();

    try {
        const lunarData = solarlunar.solar2lunar(solarYear, solarMonth, solarDay);
        const isLeapStr = lunarData.isLeap ? " (윤)" : "";
        phaseNameEl.innerHTML = `${(phase * 100).toFixed(0)}% (${getPhaseName(phase)})<br>
                                 <span style="font-size:0.8em; color:#ccc;">음력: ${lunarData.lYear}-${lunarData.lMonth}${isLeapStr}-${lunarData.lDay}</span>`;
    } catch (e) {
        // ignore
    }
}

function getPhaseName(phase) {
    const p = phase;
    if (p < 0.02 || p > 0.98) return "삭 (New Moon)";
    if (p < 0.23) return "초승달 (Waxing Crescent)";
    if (p < 0.27) return "상현달 (First Quarter)";
    if (p < 0.48) return "차오르는 달 (Waxing Gibbous)";
    if (p < 0.52) return "보름달 (Full Moon)";
    if (p < 0.73) return "이지러지는 달 (Waning Gibbous)";
    if (p < 0.77) return "하현달 (Last Quarter)";
    return "그믐달 (Waning Crescent)";
}

function onWindowResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h); // Resize label renderer too
}

function animate() {
    requestAnimationFrame(animate);

    const deltaTime = clock.getDelta(); // Time in seconds since last frame

    if (!isPaused) {
        // Advance time smoothly
        // speed 10 = 1 hour per frame (approx) in old logic
        // Let's standardise: Speed 1 = 1 hour per second.
        // Slider max 100.

        // Old logic: hoursPerFrame = timeScale * 0.1; (at 60fps, 6 hours per sec with scale 1)
        // Let's make it smoother.
        // speed 1 = 1 day per second

        const daysPerSecond = timeScale * 0.1;
        const msToAdd = daysPerSecond * 24 * 60 * 60 * 1000 * deltaTime;

        currentDate.setTime(currentDate.getTime() + msToAdd);

        updateSimulationFromDate(currentDate);
    }

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera); // Render labels
    phaseRenderer.render(phaseScene, phaseCamera);
}

function addLabel(object, text, yOffset) {
    const div = document.createElement('div');
    div.className = 'planet-label';
    div.textContent = text;
    const label = new CSS2DObject(div);
    label.position.set(0, yOffset, 0);
    object.add(label);
}

init();
