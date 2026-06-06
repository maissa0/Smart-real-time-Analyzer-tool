using UnityEngine;

[ExecuteAlways]
public class GameObjectAnimator : MonoBehaviour
{
    public enum AnimationMode
    {
        Position,
        Rotation,
        Scale
    }

    public enum AnimationAxis
    {
        X,
        Y,
        Z
    }

    public enum AnimationSpace
    {
        Local,
        Global
    }

    [SerializeField] private AnimationMode animationMode = AnimationMode.Position;
    [SerializeField] private AnimationAxis animationAxis = AnimationAxis.Y;
    [SerializeField] private AnimationSpace animationSpace = AnimationSpace.Local;
    [SerializeField] private bool capPreview = true;
    [SerializeField] private float preview = 0f;
    [SerializeField] private float minimumValue = 0f;
    [SerializeField] private float maximumValue = 1f;

    [SerializeField, HideInInspector] private bool baselineCaptured;
    [SerializeField, HideInInspector] private Vector3 baselineLocalPosition;
    [SerializeField, HideInInspector] private Vector3 baselineWorldPosition;
    [SerializeField, HideInInspector] private Vector3 baselineLocalEulerAngles;
    [SerializeField, HideInInspector] private Vector3 baselineWorldEulerAngles;
    [SerializeField, HideInInspector] private Vector3 baselineLocalScale;

    private void OnEnable()
    {
        CaptureBaselineIfNeeded();
        ApplyPreview();
    }

    private void OnValidate()
    {
        CaptureBaselineIfNeeded();
        ApplyPreview();
    }

    private void Update()
    {
        if (Application.isPlaying)
        {
            ApplyPreview();
        }
    }

    private void CaptureBaselineIfNeeded()
    {
        if (baselineCaptured)
        {
            return;
        }

        baselineLocalPosition = transform.localPosition;
        baselineWorldPosition = transform.position;
        baselineLocalEulerAngles = transform.localEulerAngles;
        baselineWorldEulerAngles = transform.eulerAngles;
        baselineLocalScale = transform.localScale;
        baselineCaptured = true;
    }

    private void ApplyPreview()
    {
        float value = capPreview ? Mathf.Lerp(minimumValue, maximumValue, Mathf.Clamp01(preview)) : preview;

        switch (animationMode)
        {
            case AnimationMode.Position:
                ApplyPosition(value);
                break;
            case AnimationMode.Rotation:
                ApplyRotation(value);
                break;
            case AnimationMode.Scale:
                ApplyScale(value);
                break;
        }
    }

    public float GetPreview()
    {
        return preview;
    }

    public void SetPreview(float normalizedPreview)
    {
        preview = capPreview ? Mathf.Clamp01(normalizedPreview) : normalizedPreview;
        ApplyPreview();
    }

    public void AddPreviewDelta(float delta)
    {
        SetPreview(preview + delta);
    }

    private void ApplyPosition(float value)
    {
        Vector3 axisOffset = GetAxisVector() * value;

        if (animationSpace == AnimationSpace.Local)
        {
            transform.localPosition = baselineLocalPosition + axisOffset;
        }
        else
        {
            transform.position = baselineWorldPosition + axisOffset;
        }
    }

    private void ApplyRotation(float value)
    {
        if (animationSpace == AnimationSpace.Local)
        {
            Vector3 euler = transform.localEulerAngles;
            SetAxisValue(ref euler, animationAxis, GetAxisValue(baselineLocalEulerAngles, animationAxis) + value);
            transform.localEulerAngles = euler;
        }
        else
        {
            Vector3 euler = transform.eulerAngles;
            SetAxisValue(ref euler, animationAxis, GetAxisValue(baselineWorldEulerAngles, animationAxis) + value);
            transform.eulerAngles = euler;
        }
    }

    private void ApplyScale(float value)
    {
        Vector3 scale = baselineLocalScale;

        switch (animationAxis)
        {
            case AnimationAxis.X:
                scale.x = value;
                break;
            case AnimationAxis.Y:
                scale.y = value;
                break;
            case AnimationAxis.Z:
                scale.z = value;
                break;
        }

        transform.localScale = scale;
    }

    private Vector3 GetAxisVector()
    {
        return animationAxis switch
        {
            AnimationAxis.X => Vector3.right,
            AnimationAxis.Y => Vector3.up,
            AnimationAxis.Z => Vector3.forward,
            _ => Vector3.up
        };
    }

    private static float GetAxisValue(Vector3 vector, AnimationAxis axis)
    {
        return axis switch
        {
            AnimationAxis.X => vector.x,
            AnimationAxis.Y => vector.y,
            AnimationAxis.Z => vector.z,
            _ => vector.y
        };
    }

    private static void SetAxisValue(ref Vector3 vector, AnimationAxis axis, float value)
    {
        switch (axis)
        {
            case AnimationAxis.X:
                vector.x = value;
                break;
            case AnimationAxis.Y:
                vector.y = value;
                break;
            case AnimationAxis.Z:
                vector.z = value;
                break;
        }
    }
}
