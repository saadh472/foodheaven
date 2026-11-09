-- Run only through manage.py against a new, dedicated demo database.
-- Deliberately no DROP, ALTER, database creation, or legacy-data migration.
CREATE TABLE dbo.Employee (
    EmployeeID INT PRIMARY KEY CHECK (EmployeeID > 0),
    EmployeeName NVARCHAR(120) NOT NULL,
    Contact NVARCHAR(32) NULL,
    EmailID NVARCHAR(254) NULL,
    Address NVARCHAR(250) NULL,
    HireDate DATE NULL,
    DateOfBirth DATE NULL,
    MgrID INT NULL REFERENCES dbo.Employee(EmployeeID)
);
CREATE TABLE dbo.Login (
    MgrID INT PRIMARY KEY REFERENCES dbo.Employee(EmployeeID),
    PasswordHash NVARCHAR(512) NOT NULL
);
CREATE TABLE dbo.Payroll (
    PayID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL UNIQUE REFERENCES dbo.Employee(EmployeeID) ON DELETE CASCADE,
    Salary DECIMAL(12,2) NOT NULL CHECK (Salary >= 0 AND Salary <= 100000)
);
CREATE TABLE dbo.Shift (
    ShiftID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL UNIQUE REFERENCES dbo.Employee(EmployeeID) ON DELETE CASCADE,
    ShiftName NVARCHAR(80) NOT NULL,
    StartTime DATETIME2 NOT NULL,
    EndTime DATETIME2 NOT NULL
);
CREATE TABLE dbo.Attendance (
    AttendID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL REFERENCES dbo.Employee(EmployeeID) ON DELETE CASCADE,
    AttendDate DATE NOT NULL,
    Status NVARCHAR(10) NOT NULL CHECK (Status IN ('Present', 'Absent')),
    CheckIN DATETIME2 NULL,
    CheckOUT DATETIME2 NULL,
    CONSTRAINT one_attendance_per_day UNIQUE (EmployeeID, AttendDate)
);
CREATE TABLE dbo.Performance (
    PerformanceID INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeID INT NOT NULL UNIQUE REFERENCES dbo.Employee(EmployeeID) ON DELETE CASCADE,
    Performance NVARCHAR(80) NOT NULL
);
CREATE INDEX attendance_date ON dbo.Attendance(AttendDate);
