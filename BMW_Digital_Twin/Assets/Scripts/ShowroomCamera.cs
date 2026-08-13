using UnityEngine;

/// <summary>
/// Orbit camera locked to fixed values: circles around CarbonConsolaDash001's
/// pivot point with Distance 4, Height 2.2, Center Offset (0, 0, 1.5).
/// Attach to the Main Camera and drag CarbonConsolaDash001 into "target".
///
/// Driven by CanBridge (which Angular reaches via SendMessage on 'CarRoot'):
///  - SetOrbitSpeed(dps) — rotation-speed slider (0–90 °/s, 0 = stopped).
///  - FocusOn(worldPos)  — "event focus": the orbit swings around to the
///    part's bearing and moves slightly closer (~85% of the orbit distance),
///    holds ~1 s, then eases back into the normal orbit.
///    No FOV change. A new event preempts the current hold.
/// </summary>
public class ShowroomCamera : MonoBehaviour
{
    [Tooltip("Orbit center — drag CarbonConsolaDash001 here.")]
    public Transform target;

    [Tooltip("Rotation speed in degrees per second (0 = stopped). Driven by the Angular slider via CanBridge.SetOrbitSpeed.")]
    public float degreesPerSecond = 30f;

    // ---- Static framing values (not editable in the Inspector) ----
    private const float Distance = 4f;
    private const float Height = 2.2f;
    private static readonly Vector3 CenterOffset = new Vector3(0f, 0f, 1.5f);

    // ---- Event-focus tuning ----
    private const float FocusDistanceFactor = 0.85f; // closes to ~85% of Distance — subtle move-in
    private const float FocusHoldSeconds = 1f;
    private const float FocusBlendPerSecond = 1.4f;  // ~0.7 s framing ease in/out
    private const float FocusSwingSharpness = 4f;    // exp ease of the angle swing

    private enum FocusPhase { None, Swing, Hold, Return }

    private float angle;
    private FocusPhase phase = FocusPhase.None;
    private Vector3 focusPoint;
    private float focusBlend; // 0 = normal orbit framing, 1 = fully focused
    private float holdTimer;

    private bool focusEnabled = true;

    public void SetOrbitSpeed(float dps)
    {
        degreesPerSecond = Mathf.Clamp(dps, 0f, 90f);
    }

    /// <summary>Angular's Focus On/Off toggle. Disabling mid-focus eases the
    /// camera straight back into its normal orbit instead of finishing the hold.</summary>
    public void SetFocusEnabled(bool enabled)
    {
        focusEnabled = enabled;
        if (!enabled && phase != FocusPhase.None) phase = FocusPhase.Return;
    }

    /// <summary>Swing toward the part at worldPos, hold, then resume the
    /// orbit. Calling again mid-swing/mid-hold retargets immediately.</summary>
    public void FocusOn(Vector3 worldPos)
    {
        if (!focusEnabled) return;
        focusPoint = worldPos;
        phase = FocusPhase.Swing;
        holdTimer = FocusHoldSeconds;
    }

    void LateUpdate()
    {
        if (target == null) return;

        // Orbit center = the object's pivot point + the fixed offset.
        Vector3 center = target.position + CenterOffset;
        float dt = Time.deltaTime;

        switch (phase)
        {
            case FocusPhase.None:
                angle += degreesPerSecond * dt;
                focusBlend = 0f;
                break;

            case FocusPhase.Swing:
            case FocusPhase.Hold:
            {
                // Ease the orbit angle onto the part's bearing; the part may
                // still be moving (opening door), so keep tracking during Hold.
                float bearing = BearingOf(focusPoint, center);
                float k = 1f - Mathf.Exp(-FocusSwingSharpness * dt);
                angle = Mathf.LerpAngle(angle, bearing, k);

                if (phase == FocusPhase.Swing)
                {
                    focusBlend = Mathf.MoveTowards(focusBlend, 1f, FocusBlendPerSecond * dt);
                    if (focusBlend >= 1f && Mathf.Abs(Mathf.DeltaAngle(angle, bearing)) < 1.5f)
                        phase = FocusPhase.Hold;
                }
                else
                {
                    holdTimer -= dt;
                    if (holdTimer <= 0f) phase = FocusPhase.Return;
                }
                break;
            }

            case FocusPhase.Return:
                // The orbit resumes turning while the framing eases back out.
                angle += degreesPerSecond * dt;
                focusBlend = Mathf.MoveTowards(focusBlend, 0f, FocusBlendPerSecond * dt);
                if (focusBlend <= 0f) phase = FocusPhase.None;
                break;
        }

        float distance = Mathf.Lerp(Distance, Distance * FocusDistanceFactor, focusBlend);
        float rad = angle * Mathf.Deg2Rad;
        Vector3 offset = new Vector3(Mathf.Sin(rad) * distance, Height, Mathf.Cos(rad) * distance);
        transform.position = center + offset;

        // Aim at the orbit center normally, at the part while focused.
        transform.LookAt(Vector3.Lerp(center, focusPoint, focusBlend));
    }

    /// <summary>Orbit angle that puts the camera on the part's side of the car
    /// (camera sits along the center→part direction, looking back through it).</summary>
    private float BearingOf(Vector3 point, Vector3 center)
    {
        Vector3 d = point - center;
        // Part directly on the orbit axis — any bearing frames it; keep the current one.
        if (d.x * d.x + d.z * d.z < 0.0001f) return angle;
        return Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg;
    }
}
