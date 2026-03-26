-- =============================================
-- 학원 관리 시스템 DB 스키마 (MySQL)
-- =============================================

CREATE DATABASE IF NOT EXISTS academy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE academy;

-- 반 테이블
CREATE TABLE IF NOT EXISTS classes (
                                       id INT AUTO_INCREMENT PRIMARY KEY,
                                       name VARCHAR(50) NOT NULL,
    school ENUM('유신고', '창현고') NOT NULL,
    grade TINYINT NOT NULL COMMENT '1 또는 2학년',
    day_of_week TINYINT NOT NULL COMMENT '0=일,1=월,2=화,3=수,4=목,5=금,6=토',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_class_grade CHECK (grade IN (1, 2)),
    CONSTRAINT chk_dow CHECK (day_of_week BETWEEN 0 AND 6)
    );

-- 학생 테이블
CREATE TABLE IF NOT EXISTS students (
                                        id INT AUTO_INCREMENT PRIMARY KEY,
                                        name VARCHAR(50) NOT NULL,
    school ENUM('유신고', '창현고') NOT NULL,
    grade TINYINT NOT NULL COMMENT '1 또는 2학년',
    is_warned BOOLEAN DEFAULT FALSE COMMENT '경고 대상자 여부',
    is_active BOOLEAN DEFAULT TRUE COMMENT '재원 여부',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_grade CHECK (grade IN (1, 2))
    );

-- 학생-반 매핑
CREATE TABLE IF NOT EXISTS student_classes (
                                               student_id INT NOT NULL,
                                               class_id INT NOT NULL,
                                               enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                               PRIMARY KEY (student_id, class_id),
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
    );

-- F 부여 기록
CREATE TABLE IF NOT EXISTS f_records (
                                         id INT AUTO_INCREMENT PRIMARY KEY,
                                         student_id INT NOT NULL,
                                         type ENUM('homework', 'retest') NOT NULL COMMENT 'homework=숙제미제출, retest=재시험미완료',
    class_date DATE NOT NULL COMMENT '해당 수업 날짜',
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );

-- 자습/재시험 일정
CREATE TABLE IF NOT EXISTS schedules (
                                         id INT AUTO_INCREMENT PRIMARY KEY,
                                         student_id INT NOT NULL,
                                         type ENUM('study', 'retest') NOT NULL COMMENT 'study=자습, retest=재시험',
    scheduled_date DATE NOT NULL COMMENT '예정 방문 날짜',
    f_homework BOOLEAN DEFAULT FALSE COMMENT '숙제 미제출 F 여부',
    f_retest   BOOLEAN DEFAULT FALSE COMMENT '재시험 미완료 F 여부',
    required_minutes INT DEFAULT NULL COMMENT '자동계산: f 1개=180분, 2개=420분',
    deadline_date DATE DEFAULT NULL COMMENT '완료 기한(다음 수업일)',
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at DATETIME DEFAULT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );

-- 자습 로그 (실제 체류 기록)
CREATE TABLE IF NOT EXISTS study_logs (
                                          id INT AUTO_INCREMENT PRIMARY KEY,
                                          student_id INT NOT NULL,
                                          schedule_id INT DEFAULT NULL,
                                          log_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    start_time DATETIME NOT NULL,
    end_time DATETIME DEFAULT NULL,
    actual_minutes INT DEFAULT NULL COMMENT '실제 자습 시간(분)',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
    );

-- 등원 기록
CREATE TABLE IF NOT EXISTS attendance_logs (
                                               id INT AUTO_INCREMENT PRIMARY KEY,
                                               student_id INT NOT NULL,
                                               log_date DATE NOT NULL DEFAULT (CURRENT_DATE),
    purpose ENUM('study', 'retest', 'general') NOT NULL DEFAULT 'general',
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
    );

-- 관리자 테이블
CREATE TABLE IF NOT EXISTS admins (
                                      id INT AUTO_INCREMENT PRIMARY KEY,
                                      name VARCHAR(50) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE COMMENT '로그인 코드',
    role ENUM('admin', 'super') NOT NULL DEFAULT 'admin',
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

INSERT INTO admins (name, code, role) VALUES ('슈퍼관리자', 'super1234', 'super')
    ON DUPLICATE KEY UPDATE name = name;

-- 기본 슈퍼 관리자 (코드: super1234)
INSERT INTO admins (name, code, role) VALUES ('슈퍼관리자', 'super1234', 'super')
  ON DUPLICATE KEY UPDATE name = name;

--반 데이터
INSERT INTO classes (name, school, grade, day_of_week) VALUES
    ('유신고2 일요반', '유신고', 2, 0),
    ('창현고2 일요반', '창현고', 2, 0),
    ('유신고1 화요반', '유신고', 1, 2),
    ('창현고1 수요반', '창현고', 1, 3),
    ('창현고1 목요반', '창현고', 1, 4),
    ('유신고2 금요반', '유신고', 2, 5),
    ('유신고1 토요반', '유신고', 1, 6)
ON DUPLICATE KEY UPDATE name = name;
