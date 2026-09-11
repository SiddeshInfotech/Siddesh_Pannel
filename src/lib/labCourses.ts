// LMS Lab course registry — the licence server's side of the per-course content keys.
//
// Every Lab video is encrypted under the scope of its course folder (course_<number>), and
// /api/activate wraps one CEK per scope to the device. The same numbering MUST be used by:
//   - the app:        LAB_SCOPE_BY_PATH_SEGMENT  (LMS-Lab shared/ui/.../activation/DeviceActivation.kt)
//   - the encryptor:  LAB_SCOPE_BY_FOLDER        (LMS-Lab encrypt_lab_videos.py)
//   - the curriculum: NEW_COURSES               (LMS-Lab add_lab_courses.py → class_lab.json)
// A course's number is permanent once content is encrypted with it — never renumber or reuse.

export type LabCourse = {
  /** course_<number> CEK scope. */
  number: number;
  /** Top-level video folder (first segment of every video_relative_path). */
  folder: string;
  name: string;
};

export const LAB_COURSES: readonly LabCourse[] = [
  { number: 1, folder: 'electronics', name: 'Electronics' },
  { number: 2, folder: 'robotics', name: 'Robotics' },
  { number: 3, folder: 'iot', name: 'IoT (Internet of Things)' },
  { number: 4, folder: 'ai', name: 'AI (Artificial Intelligence)' },
  { number: 5, folder: 'drone', name: 'Drone' },
  { number: 6, folder: '3d-printing', name: '3D Printing' },
  { number: 7, folder: 'ar', name: 'AR (Augmented Reality)' },
  { number: 8, folder: 'vr', name: 'VR (Virtual Reality)' },
  { number: 9, folder: 'mr', name: 'MR (Mixed Reality)' },
  { number: 10, folder: 'scratch', name: 'Scratch Programming' },
  { number: 11, folder: 'c-programming', name: 'C Programming' },
];

/**
 * Highest course_<N> scope provisioned in EVERY Lab activation.
 *
 * Scopes above the last real course are RESERVED for courses not built yet. A device only
 * receives content keys during activation, and activation keys are single-use — so a device
 * activated today could never obtain the key of a course added next year. Provisioning the
 * reserved slots now means a new course (numbered within this range) plays on every device
 * activated from here on, with no re-activation and no app update to the key logic.
 *
 * Trade-off: every Lab licence receives the reserved keys. That matches today's model (a Lab
 * licence is entitled to ALL Lab courses). If courses are ever sold individually, replace
 * this with a per-licence entitlement list before reusing a reserved slot for a paid add-on.
 *
 * Raising this is safe (newly activated devices get more slots); lowering it would strand
 * content encrypted under a dropped slot.
 */
export const LAB_SCOPE_MAX = 20;

/** Every course_<N> scope a Lab activation must carry: real courses + reserved slots. */
export function labScopeIds(): string[] {
  const top = Math.max(LAB_SCOPE_MAX, ...LAB_COURSES.map((c) => c.number));
  return Array.from({ length: top }, (_, i) => `course_${i + 1}`);
}
