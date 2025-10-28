/**
 * 3D Physics Engine for State Manager
 * Handles forces, gravity, thrust, and movement in 3D space
 */

/**
 * Vector3D utility class for physics calculations
 */
class Vector3D {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  // Vector addition
  add(v) {
    return new Vector3D(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  // Vector subtraction
  subtract(v) {
    return new Vector3D(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  // Scalar multiplication
  multiply(scalar) {
    return new Vector3D(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  // Vector magnitude (length)
  magnitude() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  // Normalize vector (unit vector)
  normalize() {
    const mag = this.magnitude();
    if (mag === 0) return new Vector3D(0, 0, 0);
    return new Vector3D(this.x / mag, this.y / mag, this.z / mag);
  }

  // Dot product
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  // Cross product
  cross(v) {
    return new Vector3D(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  // Distance to another vector
  distanceTo(v) {
    return this.subtract(v).magnitude();
  }
}

/**
 * Physics Constants
 */
const PHYSICS_CONSTANTS = {
  // Gravitational constant (scaled for game)
  G: 0.1,
  
  // Time step for physics updates (seconds)
  DELTA_TIME: 0.1,
  
  // Maximum velocity (units per second)
  MAX_VELOCITY: 100,
  
  // Drag coefficient (resistance to movement)
  DRAG: 0.01,
  
  // Minimum distance for gravity calculations (prevents singularities)
  MIN_GRAVITY_DISTANCE: 5
};

/**
 * Physics Engine Class
 */
export class Physics3D {
  constructor() {
    this.constants = PHYSICS_CONSTANTS;
  }

  /**
   * Calculate gravitational force between two bodies
   * F = G * (m1 * m2) / r^2
   * 
   * @param {Object} body1 - First body {position: {x,y,z}, mass: number}
   * @param {Object} body2 - Second body {position: {x,y,z}, mass: number}
   * @returns {Vector3D} - Force vector applied to body1
   */
  calculateGravity(body1, body2) {
    const pos1 = new Vector3D(body1.position.x, body1.position.y, body1.position.z);
    const pos2 = new Vector3D(body2.position.x, body2.position.y, body2.position.z);
    
    // Direction from body1 to body2
    const direction = pos2.subtract(pos1);
    const distance = Math.max(direction.magnitude(), this.constants.MIN_GRAVITY_DISTANCE);
    
    // Gravitational force magnitude: F = G * m1 * m2 / r^2
    const forceMagnitude = this.constants.G * body1.mass * body2.mass / (distance * distance);
    
    // Force vector in direction of body2
    const forceDirection = direction.normalize();
    return forceDirection.multiply(forceMagnitude);
  }

  /**
   * Calculate thrust force from ship engines
   * 
   * @param {Object} ship - Ship object with thrust and direction
   * @param {Vector3D} direction - Direction vector (will be normalized)
   * @param {Number} thrustPower - Thrust power (0-1)
   * @returns {Vector3D} - Thrust force vector
   */
  calculateThrust(ship, direction, thrustPower = 1.0) {
    const maxThrust = ship.stats?.maxThrust || 10;
    const thrustDirection = direction.normalize();
    return thrustDirection.multiply(maxThrust * thrustPower);
  }

  /**
   * Calculate drag force (resistance to movement)
   * F_drag = -drag_coefficient * velocity
   * 
   * @param {Vector3D} velocity - Current velocity
   * @returns {Vector3D} - Drag force vector
   */
  calculateDrag(velocity) {
    return velocity.multiply(-this.constants.DRAG);
  }

  /**
   * Apply forces to update velocity
   * v_new = v_old + (F_total / mass) * dt
   * 
   * @param {Object} body - Body with velocity and mass
   * @param {Array<Vector3D>} forces - Array of force vectors to apply
   * @returns {Vector3D} - New velocity vector
   */
  updateVelocity(body, forces) {
    const currentVelocity = new Vector3D(
      body.velocity?.x || 0,
      body.velocity?.y || 0,
      body.velocity?.z || 0
    );

    // Sum all forces
    let totalForce = new Vector3D(0, 0, 0);
    forces.forEach(force => {
      totalForce = totalForce.add(force);
    });

    // Add drag force
    const dragForce = this.calculateDrag(currentVelocity);
    totalForce = totalForce.add(dragForce);

    // Apply Newton's second law: a = F / m
    const mass = body.mass || 1;
    const acceleration = totalForce.multiply(1 / mass);

    // Update velocity: v = v + a * dt
    let newVelocity = currentVelocity.add(acceleration.multiply(this.constants.DELTA_TIME));

    // Clamp to max velocity
    const speed = newVelocity.magnitude();
    if (speed > this.constants.MAX_VELOCITY) {
      newVelocity = newVelocity.normalize().multiply(this.constants.MAX_VELOCITY);
    }

    return newVelocity;
  }

  /**
   * Update position based on velocity
   * pos_new = pos_old + velocity * dt
   * 
   * @param {Object} body - Body with position and velocity
   * @returns {Vector3D} - New position vector
   */
  updatePosition(body) {
    const currentPosition = new Vector3D(
      body.position.x || 0,
      body.position.y || 0,
      body.position.z || 0
    );

    const velocity = new Vector3D(
      body.velocity?.x || 0,
      body.velocity?.y || 0,
      body.velocity?.z || 0
    );

    // pos = pos + v * dt
    const displacement = velocity.multiply(this.constants.DELTA_TIME);
    return currentPosition.add(displacement);
  }

  /**
   * Calculate orbital velocity for circular orbit
   * v = sqrt(G * M / r)
   * 
   * @param {Object} centralBody - Body being orbited
   * @param {Number} orbitRadius - Radius of orbit
   * @returns {Number} - Orbital velocity magnitude
   */
  calculateOrbitalVelocity(centralBody, orbitRadius) {
    const mass = centralBody.mass || 1000;
    return Math.sqrt(this.constants.G * mass / orbitRadius);
  }

  /**
   * Set body in circular orbit around another body
   * 
   * @param {Object} orbitingBody - Body to put in orbit
   * @param {Object} centralBody - Body to orbit around
   * @param {Number} radius - Orbit radius
   * @param {Number} inclination - Orbit inclination angle (radians)
   * @returns {Object} - New position and velocity
   */
  setCircularOrbit(orbitingBody, centralBody, radius, inclination = 0) {
    const centralPos = new Vector3D(
      centralBody.position.x,
      centralBody.position.y,
      centralBody.position.z
    );

    // Random starting angle
    const theta = Math.random() * Math.PI * 2;

    // Position on orbit
    const x = centralPos.x + radius * Math.cos(theta) * Math.cos(inclination);
    const y = centralPos.y + radius * Math.sin(theta);
    const z = centralPos.z + radius * Math.cos(theta) * Math.sin(inclination);

    const position = new Vector3D(x, y, z);

    // Orbital velocity (perpendicular to radius vector)
    const orbitalSpeed = this.calculateOrbitalVelocity(centralBody, radius);
    
    // Velocity perpendicular to position relative to central body
    const radiusVector = position.subtract(centralPos);
    const up = new Vector3D(0, 1, 0);
    const velocityDirection = radiusVector.cross(up).normalize();
    
    const velocity = velocityDirection.multiply(orbitalSpeed);

    return {
      position: { x: position.x, y: position.y, z: position.z },
      velocity: { x: velocity.x, y: velocity.y, z: velocity.z }
    };
  }

  /**
   * Full physics update for a body
   * Applies all forces and updates position/velocity
   * 
   * @param {Object} body - Body to update
   * @param {Array<Vector3D>} forces - Forces to apply
   * @returns {Object} - Updated body state
   */
  update(body, forces = []) {
    const newVelocity = this.updateVelocity(body, forces);
    
    // Update body velocity for position calculation
    body.velocity = {
      x: newVelocity.x,
      y: newVelocity.y,
      z: newVelocity.z
    };

    const newPosition = this.updatePosition(body);

    return {
      position: {
        x: newPosition.x,
        y: newPosition.y,
        z: newPosition.z
      },
      velocity: {
        x: newVelocity.x,
        y: newVelocity.y,
        z: newVelocity.z
      }
    };
  }
}

// Export Vector3D utility for use in other modules
export { Vector3D, PHYSICS_CONSTANTS };

export default Physics3D;
