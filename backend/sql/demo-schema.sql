-- Run against a dedicated project_database database.
-- This creates the columns used by the companion FoodHeaven dashboard.
IF OBJECT_ID(N'dbo.EMPLOYEE', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.EMPLOYEE (
        EmployeeID INT IDENTITY(1,1) PRIMARY KEY,
        EmployeeName NVARCHAR(120) NOT NULL,
        ContactNo NVARCHAR(32) NULL,
        EmailID NVARCHAR(254) NULL,
        Address NVARCHAR(250) NULL,
        HireDate DATE NULL,
        DateOfBirth DATE NULL
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.EMPLOYEE)
BEGIN
    INSERT INTO dbo.EMPLOYEE (
        EmployeeName, ContactNo, EmailID, Address, HireDate, DateOfBirth
    )
    VALUES (
        N'Demo Employee', N'0000000000', N'demo.employee@example.com',
        N'Demo office', '2024-01-15', '1995-06-01'
    );
END;
GO
