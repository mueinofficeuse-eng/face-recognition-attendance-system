// ================= API CONFIG =================
const BASE_API = "https://zabjz20fn3.execute-api.ap-south-1.amazonaws.com/dev";

const UPLOAD_URL_API = `${BASE_API}/get-upload-url`;
const ATTENDANCE_API = `${BASE_API}/attendance`;
const RECORDS_API = `${BASE_API}/attendance-records`;

// ================= GLOBAL STATE =================
let selectedFile = null;

/**
 * 2️⃣ Select image → preview appears
 * 3️⃣ Upload button becomes enabled
 */
function handleFileSelect(event) {
  const file = event.target.files[0];
  const preview = document.getElementById("previewImage");
  const placeholder = document.getElementById("placeholderText");
  const status = document.getElementById("uploadStatus");
  const uploadBtn = document.getElementById("uploadBtn");
  const indicator = document.getElementById("cameraStatusIndicator");

  if (!file) {
    // If selection cleared, reset the UI
    selectedFile = null;
    preview.src = "";
    preview.style.display = "none";
    placeholder.style.display = "flex";
    uploadBtn.disabled = true;
    uploadBtn.classList.remove("ready");
    indicator.classList.remove("active");
    return;
  }

  selectedFile = file;

  // Show preview
  preview.src = URL.createObjectURL(selectedFile);
  preview.style.display = "block";
  placeholder.style.display = "none";

  // Enable upload button and indicator
  uploadBtn.disabled = false;
  uploadBtn.classList.add("ready");
  indicator.classList.add("active");

  // Clear previous status
  status.innerText = "📸 Image ready for upload";
  status.style.color = "var(--text-secondary)";
}

/**
 * 4️⃣ Click Confirm & Upload Attendance
 * 5️⃣ Attendance message shows
 * 6️⃣ Records table refreshes automatically
 */
async function uploadPhoto() {
  const status = document.getElementById("uploadStatus");
  const fileInput = document.getElementById("fileInput");
  const uploadBtn = document.getElementById("uploadBtn");

  status.innerText = "Uploading photo...";
  status.style.color = "#0ea5e9";

  const selectedFile = fileInput.files[0];
  if (!selectedFile) {
    status.innerText = "Please select a photo first.";
    status.style.color = "#ef4444";
    return;
  }

  try {
    // 1️⃣ Get presigned URL
    const urlRes = await fetch(UPLOAD_URL_API);
    if (!urlRes.ok) throw new Error("Failed to get upload URL");

    const { uploadUrl, fileName } = await urlRes.json();
    console.log("Presigned URL:", uploadUrl);

    // 2️⃣ Upload to S3 (CRITICAL PART)
    const s3Res = await fetch(uploadUrl, {
      method: "PUT",
      body: selectedFile,
      headers: {
        "Content-Type": "image/jpeg"
      }
    });

    console.log("S3 response status:", s3Res.status);

    if (!s3Res.ok) {
      throw new Error("S3 upload failed with status " + s3Res.status);
    }

    // 3️⃣ Call mark-attendance
    const attendanceRes = await fetch(ATTENDANCE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imageName: fileName
      })
    });

    if (!attendanceRes.ok) {
      throw new Error("Attendance verification failed");
    }

    let result = await attendanceRes.json();
    console.log("Raw API Response:", result);

    // Deep Unwrapping: Loop until we find the actual data (handles double-wrapping)
    let parseCount = 0;
    while (result.body && typeof result.body === 'string' && parseCount < 3) {
      try {
        result = JSON.parse(result.body);
        parseCount++;
      } catch (e) { break; }
    }
    console.log("Final Parsed Result:", result);

    if (result.attendanceMarked) {
      status.innerText = `✅ Attendance marked: ${result.employeeId || result.name || "User"}`;
      status.style.color = "#10b981";

      // ✅ Refresh records table automatically
      await loadRecords();
    } else {
      console.log("Recognition Failed:", result);
      status.innerText = `❌ ${result.message || "Face not recognized."}`;
      status.style.color = "#ef4444";
    }

  } catch (err) {
    console.error("Attendance Error:", err);
    status.innerText = "❌ System Error: Failed to fetch";
    status.style.color = "#ef4444";
  }
}

/**
 * Fetches and displays the recent attendance records
 */
async function loadRecords() {
  const tableBody = document.getElementById("recordsTable");

  try {
    const response = await fetch(RECORDS_API);
    if (!response.ok) throw new Error("Failed to fetch records");
    let records = await response.json();

    // Deep Unwrapping for records
    let recordsParseCount = 0;
    while (records.body && typeof records.body === 'string' && recordsParseCount < 3) {
      try {
        records = JSON.parse(records.body);
        recordsParseCount++;
      } catch (e) { break; }
    }

    tableBody.innerHTML = "";

    if (!records || records.length === 0) {
      tableBody.innerHTML = "<tr><td colspan='4' style='text-align:center;'>No attendance records found</td></tr>";
      return;
    }

    records.forEach((record) => {
      const row = document.createElement("tr");

      // Matching your markAttendance/getRecentAttendance data exactly
      const id = record.employeeId || "Unknown";
      const time = record.timestamp || "N/A";
      const status = record.status || "Verified";
      const confidence = record.confidence ? `(${Math.round(record.confidence)}%)` : "";

      row.innerHTML = `
                <td><strong>${id}</strong></td>
                <td><span class="face-id-code">Face Verified ${confidence}</span></td>
                <td>${time}</td>
                <td><span class="status-pill">${status}</span></td>
            `;

      tableBody.appendChild(row);
    });

  } catch (error) {
    console.error("Records Load Error:", error);
    tableBody.innerHTML = "<tr><td colspan='4' style='text-align:center; color: #ef4444;'>Failed to load records</td></tr>";
  }
}

// Initial load on page start
window.onload = loadRecords;
