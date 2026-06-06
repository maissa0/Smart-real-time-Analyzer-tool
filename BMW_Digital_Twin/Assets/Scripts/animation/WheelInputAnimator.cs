using UnityEngine;

public class WheelInputAnimator : MonoBehaviour
{
    [System.Serializable]
    private class FrontWheelAnimatorSet
    {
        public GameObjectAnimator xRotationAnimator;
        public GameObjectAnimator ySteeringAnimator;
    }

    [Header("Front wheels")]
    [SerializeField] private FrontWheelAnimatorSet[] frontWheels;

    [Header("Rear wheels (X rotation only)")]
    [SerializeField] private GameObjectAnimator[] rearWheelDriveAnimators;

    [Header("Drive (X rotation)")]
    [SerializeField] private float driveSpeed = 0.8f;

    [Header("Steer (Y rotation)")]
    [SerializeField] private float steerSpeed = 1.5f;
    [SerializeField] private float steerReturnSpeed = 2f;

    private void Update()
    {
        float deltaTime = Time.deltaTime;

        float driveDirection = Input.GetAxis("Vertical");

        if (!Mathf.Approximately(driveDirection, 0f))
        {
            ApplyDriveDelta(driveDirection * driveSpeed * deltaTime);
        }

        float steerDirection = Input.GetAxis("Horizontal");

        if (!Mathf.Approximately(steerDirection, 0f))
        {
            ApplySteerDelta(steerDirection * steerSpeed * deltaTime);
            return;
        }

        ReturnSteeringToCenter(deltaTime);
    }

    private void ApplyDriveDelta(float delta)
    {
        if (frontWheels != null)
        {
            for (int i = 0; i < frontWheels.Length; i++)
            {
                GameObjectAnimator animator = frontWheels[i]?.xRotationAnimator;
                if (animator == null)
                {
                    continue;
                }

                animator.AddPreviewDelta(delta);
            }
        }

        ApplyDeltaToArray(rearWheelDriveAnimators, delta);
    }

    private void ApplySteerDelta(float delta)
    {
        if (frontWheels == null)
        {
            return;
        }

        for (int i = 0; i < frontWheels.Length; i++)
        {
            GameObjectAnimator animator = frontWheels[i]?.ySteeringAnimator;
            if (animator == null)
            {
                continue;
            }

            animator.AddPreviewDelta(delta);
        }
    }

    private void ReturnSteeringToCenter(float deltaTime)
    {
        if (frontWheels == null)
        {
            return;
        }

        for (int i = 0; i < frontWheels.Length; i++)
        {
            GameObjectAnimator animator = frontWheels[i]?.ySteeringAnimator;
            if (animator == null)
            {
                continue;
            }

            float currentPreview = animator.GetPreview();
            float centeredPreview = Mathf.MoveTowards(currentPreview, 0.5f, steerReturnSpeed * deltaTime);
            animator.SetPreview(centeredPreview);
        }
    }

    private void ApplyDeltaToArray(GameObjectAnimator[] animators, float delta)
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
