DROP PROCEDURE IF EXISTS ActivateSubscription;

DELIMITER //

CREATE PROCEDURE ActivateSubscription(
  IN p_userId   INT,
  IN p_planType VARCHAR(20)
)
BEGIN
  DECLARE active_count INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  -- Validate plan type
  IF LOWER(p_planType) NOT IN ('basic', 'standard', 'premium') THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Invalid subscription plan selected.';
  END IF;

  START TRANSACTION;

    -- Check if user already has any active subscription
    SELECT COUNT(*) INTO active_count
    FROM subscriptions
    WHERE user_id = p_userId
      AND status = 'active';

    IF active_count > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'You already have an active subscription on this account.';
    END IF;

    -- Insert the new subscription
    INSERT INTO subscriptions (user_id, plan_type, start_date, end_date, status)
    VALUES (p_userId, LOWER(p_planType), CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'active');

  COMMIT;

  SELECT 'Subscription activated successfully.' AS message;
END //

DELIMITER ;
