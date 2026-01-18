# API Gateway Structure

This file outlines the resources and methods required for the Attendance System API.

## Resources and Methods

### `/`

### `/attendance`
*   **GET**: Retrieve attendance information.
*   **OPTIONS**: Preflight for POST/GET requests.
*   **POST**: Submit new attendance data (Trigger: `markAttendance` Lambda).

### `/attendance-records`
*   **GET**: Retrieve the latest attendance list (Trigger: `getRecentAttendance` Lambda).
*   **OPTIONS**: Preflight for GET requests.

### `/get-upload-url`
*   **GET**: Generate a pre-signed S3 URL for image uploads (Trigger: `getUploadUrl` Lambda).
*   **OPTIONS**: Preflight for GET requests.
