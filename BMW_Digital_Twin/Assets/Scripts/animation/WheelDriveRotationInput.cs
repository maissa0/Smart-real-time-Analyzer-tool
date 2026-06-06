using UnityEngine;

public class WheelDriveRotationInput : MonoBehaviour
{
    [Header("Front wheels (X rotation animators)")]
    [SerializeField] private GameObjectAnimator[] frontWheelAnimators;

    [Header("Rear wheels (X rotation animators)")]
    [SerializeField] private GameObjectAnimator[] rearWheelAnimators;

    [Header("Drive settings")]
    [SerializeField] private string verticalAxis = "Vertical";
    [SerializeField] private float driveSpeed = 0.8f;

    private void Update()
    {
        float driveInput = Input.GetAxis(verticalAxis);
        if (Mathf.Approximately(driveInput, 0f))
        {
            return;
        }

        float delta = driveInput * driveSpeed * Time.deltaTime;
        ApplyDelta(frontWheelAnimators, delta);
        ApplyDelta(rearWheelAnimators, delta);
    }

    private static void ApplyDelta(GameObjectAnimator[] animators, float delta)
    {
        if (animators == null)
        {
            return;
        }

        for (int i = 0; i < animators.Length; i++)
        {
            if (animators[i] == null)
            {
                continue;
            }

            animators[i].AddPreviewDelta(delta);
        }
    }
}
