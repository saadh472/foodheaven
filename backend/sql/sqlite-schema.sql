-- New SQLite demo databases only. Existing files are never migrated automatically.
CREATE TABLE Employee (
    EmployeeID INTEGER PRIMARY KEY CHECK (EmployeeID > 0),
    EmployeeName TEXT NOT NULL,
    Contact TEXT,
    EmailID TEXT,
    Address TEXT,
    HireDate TEXT,
    DateOfBirth TEXT,
    MgrID INTEGER REFERENCES Employee(EmployeeID) ON DELETE RESTRICT
);
CREATE TABLE Login (
    MgrID INTEGER PRIMARY KEY REFERENCES Employee(EmployeeID) ON DELETE RESTRICT,
    PasswordHash TEXT NOT NULL
);
CREATE TABLE Payroll (
    PayID INTEGER PRIMARY KEY AUTOINCREMENT,
    EmployeeID INTEGER NOT NULL UNIQUE REFERENCES Employee(EmployeeID) ON DELETE CASCADE,
    Salary NUMERIC NOT NULL CHECK (Salary >= 0 AND Salary <= 100000)
);
CREATE TABLE Shift (
    ShiftID INTEGER PRIMARY KEY AUTOINCREMENT,
    EmployeeID INTEGER NOT NULL UNIQUE REFERENCES Employee(EmployeeID) ON DELETE CASCADE,
    ShiftName TEXT NOT NULL,
    StartTime TEXT NOT NULL,
    EndTime TEXT NOT NULL
);
CREATE TABLE Attendance (
    AttendID INTEGER PRIMARY KEY AUTOINCREMENT,
    EmployeeID INTEGER NOT NULL REFERENCES Employee(EmployeeID) ON DELETE CASCADE,
    AttendDate TEXT NOT NULL,
    Status TEXT NOT NULL CHECK (Status IN ('Present', 'Absent')),
    CheckIN TEXT,
    CheckOUT TEXT,
    UNIQUE (EmployeeID, AttendDate)
);
CREATE TABLE Performance (
    PerformanceID INTEGER PRIMARY KEY AUTOINCREMENT,
    EmployeeID INTEGER NOT NULL UNIQUE REFERENCES Employee(EmployeeID) ON DELETE CASCADE,
    Performance TEXT NOT NULL
);
CREATE INDEX attendance_date ON Attendance(AttendDate);
