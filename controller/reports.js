const Report = require('../models/report');
const mongoose = require("mongoose");
const axios = require('axios');
const multer = require('multer'); 
const path = require('path');
const PDFLib = require('pdf-lib');

const fs = require('fs');
const uploadsDir = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); 
    }
});


const upload = multer({ storage: storage }).array('pdfFiles', 5); 

const generateFormNumber = async (formType) => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); 
    const day = String(date.getDate()).padStart(2, '0'); 

    const count = await Report.countDocuments() + 1;

    return `${formType}-${year}${month}${day}-${count}`;
};


exports.getReports = async (req, res) => {
    try {
      const reports = await Report.find();
      res.status(200).json(reports);
    } catch (error) {
      console.error('Error fetching reports:', error);
      res.status(500).json({ message: 'Internal Server Error' });
    }
  };



  const saveBase64File = (base64String, formNumber) => {
    try {
        console.log("🟢 Saving PDF for Form Number:", formNumber);

        if (!base64String.startsWith("data:application/pdf;base64,")) {
            throw new Error("Invalid PDF Base64 format");
        }

        const base64Data = base64String.replace(/^data:application\/pdf;base64,/, "");
        const pdfBuffer = Buffer.from(base64Data, "base64");
        const filePath = path.join(__dirname, "../uploads", `${formNumber}.pdf`);

        fs.writeFileSync(filePath, pdfBuffer);
        console.log("✅ PDF Saved at:", filePath);

        return `/uploads/${formNumber}.pdf`;
    } catch (error) {
        console.error("❌ Error saving PDF:", error);
        return null;
    }
};




// -----------------------------------------------------------------------


// Helper: Required forms
const REQUIRED_FORM_TYPES = ['wardbilllist', 'form22', 'karyalayintipani'];

// Helper: Check if all required forms are approved by a specific role
const areAllFormsApprovedByRole = (report, role, ward) => {
  const roleRemark = report.reportingRemarks.find(r => 
    r.role === role && (r.ward === ward || r.userWard === ward) && r.remark === "Approved"
  );
  if (!roleRemark) return false;

  if (role === "Lipik") {
    const approvedFormTypes = roleRemark.documents.map(doc => doc.formType);
    return REQUIRED_FORM_TYPES.every(type => approvedFormTypes.includes(type));
  }

  const lipikRemark = report.reportingRemarks.find(r => r.role === "Lipik");
  if (!lipikRemark || !lipikRemark.documents?.length) return false;

  return REQUIRED_FORM_TYPES.every(type => {
    const doc = lipikRemark.documents.find(d => d.formType === type);
    return doc && doc.approvedBy?.includes(roleRemark.userId.toString());
  });
};

// Helper: Get missing form types
const getMissingFormTypes = (report, role, ward, userId) => {
  if (role === "Lipik") {
    const lipikRemark = report.reportingRemarks.find(r => r.role === role && (r.ward === ward || r.userWard === ward));
    const approvedTypes = lipikRemark?.documents?.map(doc => doc.formType) || [];
    return REQUIRED_FORM_TYPES.filter(type => !approvedTypes.includes(type));
  } else {
    const lipikRemark = report.reportingRemarks.find(r => r.role === "Lipik");
    if (!lipikRemark || !lipikRemark.documents) return REQUIRED_FORM_TYPES;

    return REQUIRED_FORM_TYPES.filter(type => {
      const doc = lipikRemark.documents.find(d => d.formType === type);
      return !doc?.approvedBy?.includes(userId);
    });
  }
};

// Helper: Populate doneBy array
const populateDoneByArray = (document, reportingRemarks, ward) => {
  const doneBy = [];
  document.approvedBy?.forEach(userId => {
    const userRemark = reportingRemarks.find(r => r.userId.toString() === userId.toString() && r.remark === "Approved");
    if (userRemark) {
      doneBy.push({
        formType: document.formType,
        userId,
        role: userRemark.role,
        status: 'verified',
        ward,
        userWard: userRemark.userWard || userRemark.ward
      });
    }
  });
  return doneBy;
};

// Helper: Update document doneBy
const updateDocumentDoneBy = (document, reportingRemarks, ward) => {
  document.doneBy = populateDoneByArray(document, reportingRemarks, ward);
  return document;
};

// Main controller
// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;
//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");

//     if (missingFields.length) return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });

//     const formNumber = await generateFormNumber(formType);
//     let document = null;

//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) return res.status(400).json({ message: "Invalid base64 PDF." });
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     let report;

//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r => r.userId.toString() === userId && r.role === "Junior Engineer" && (r.ward === "Head Office" || r.userWard === "Head Office"));

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           lipik?.documents?.forEach(doc => {
//             if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//             doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
//           });
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) report = new Report({ seleMonth, ward, monthReport: seleMonth, reportingRemarks: [] });

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     // Hierarchy checks
//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(report, checkRole, checkRole === "Junior Engineer" ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w)) : ward, userId);
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r => r.userId.toString() === userId && r.role === role && (r.ward === ward || r.userWard === ward));

//     if (index !== -1) {
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         lipik?.documents?.forEach(doc => {
//           if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//         });
//       }

//       report.reportingRemarks[index] = existing;
//     } else {
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) return res.status(400).json({ message: "Lipik remark not found." });

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           if (!doc.signatures) doc.signatures = {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
//           lipik.documents.push(newDoc);
//         }
//       }

//       report.reportingRemarks.push(remarkObj);
//     }

//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward));
//     await report.save();

//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };
// ==========================================================

// // Main controller
// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;
//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");

//     if (missingFields.length) return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });

//     const formNumber = await generateFormNumber(formType);
//     let document = null;

//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) return res.status(400).json({ message: "Invalid base64 PDF." });
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // PDF Update Function - Inline
//     const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum) => {
//       try {
//         const existingPdfBytes = fs.readFileSync(pdfPath);
//         const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//         const pages = pdfDoc.getPages();
//         const firstPage = pages[0];
//         const { width, height } = firstPage.getSize();

//         // Define signature positions
//         const signaturePositions = {
//           'Lipik': { x: 50, y: height - 150 },
//           'Junior Engineer': { x: 200, y: height - 150 },
//           'Accountant': { x: 350, y: height - 150 },
//           'Assistant Municipal Commissioner': { x: 50, y: height - 250 },
//           'Dy.Municipal Commissioner': { x: 200, y: height - 250 }
//         };

//         // Add signatures for each approved role
//         for (const approval of approvalData) {
//           if (approval.signature && signaturePositions[approval.role]) {
//             const position = signaturePositions[approval.role];

//             // Add role label
//             firstPage.drawText(`${approval.role}:`, {
//               x: position.x,
//               y: position.y + 30,
//               size: 10,
//               color: PDFLib.rgb(0, 0, 0)
//             });

//             // Add status
//             firstPage.drawText(`Status: ${approval.status || 'verified'}`, {
//               x: position.x,
//               y: position.y + 15,
//               size: 8,
//               color: PDFLib.rgb(0, 0.5, 0)
//             });

//             // Add date
//             firstPage.drawText(`Date: ${new Date(approval.date).toLocaleDateString()}`, {
//               x: position.x,
//               y: position.y,
//               size: 8,
//               color: PDFLib.rgb(0, 0, 0)
//             });

//             // Add signature image if available
//             if (approval.signature && approval.signature.startsWith('data:image')) {
//               try {
//                 const signatureBase64 = approval.signature.split(',')[1];
//                 const signatureBytes = Buffer.from(signatureBase64, 'base64');

//                 let embeddedImage;
//                 if (approval.signature.includes('png')) {
//                   embeddedImage = await pdfDoc.embedPng(signatureBytes);
//                 } else if (approval.signature.includes('jpg') || approval.signature.includes('jpeg')) {
//                   embeddedImage = await pdfDoc.embedJpg(signatureBytes);
//                 }

//                 if (embeddedImage) {
//                   firstPage.drawImage(embeddedImage, {
//                     x: position.x,
//                     y: position.y - 40,
//                     width: 80,
//                     height: 30
//                   });
//                 }
//               } catch (imageError) {
//                 firstPage.drawText('Signature Applied', {
//                   x: position.x,
//                   y: position.y - 20,
//                   size: 8,
//                   color: PDFLib.rgb(0, 0, 0.8)
//                 });
//               }
//             } else {
//               firstPage.drawText('Signature Applied', {
//                 x: position.x,
//                 y: position.y - 20,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0, 0.8)
//               });
//             }
//           }
//         }

//         const pdfBytes = await pdfDoc.save();
//         const updatedPdfPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//         fs.writeFileSync(updatedPdfPath, pdfBytes);
//         return updatedPdfPath;
//       } catch (error) {
//         console.error('Error updating PDF:', error);
//         throw error;
//       }
//     };

//     // Create approval data from reporting remarks
//     const createApprovalData = (reportingRemarks, targetWard) => {
//       return reportingRemarks
//         .filter(remark => remark.ward === targetWard || remark.userWard === targetWard)
//         .map(remark => ({
//           role: remark.role,
//           remark: remark.remark,
//           signature: remark.signature,
//           date: remark.date,
//           status: remark.remark === 'Approved' ? 'verified' : 'pending',
//           ward: remark.ward || remark.userWard
//         }))
//         .sort((a, b) => {
//           const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//           return hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role);
//         });
//     };

//     let report;

//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r => r.userId.toString() === userId && r.role === "Junior Engineer" && (r.ward === "Head Office" || r.userWard === "Head Office"));

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
              
//               // Update PDF with Head Office JE signature
//               try {
//                 const approvalData = createApprovalData([...report.reportingRemarks, jeRemark], wardName);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error('Error updating PDF for Head Office JE:', pdfError);
//               }
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) report = new Report({ seleMonth, ward, monthReport: seleMonth, reportingRemarks: [] });

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     // Hierarchy checks
//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(report, checkRole, checkRole === "Junior Engineer" ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w)) : ward, userId);
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r => r.userId.toString() === userId && r.role === role && (r.ward === ward || r.userWard === ward));

//     if (index !== -1) {
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for updated document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik update:', pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for new document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik new:', pdfError);
//             }
//           }
          
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       // Update PDF for all approved roles
//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
              
//               // Update PDF with current role signature
//               try {
//                 const approvalData = createApprovalData(report.reportingRemarks, ward);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error(`Error updating PDF for ${role}:`, pdfError);
//               }
//             }
//           }
//         }
//       }

//       report.reportingRemarks[index] = existing;
//     } else {
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
        
//         // Update PDF with initial Lipik signature
//         try {
//           const approvalData = createApprovalData([remarkObj], ward);
//           const updatedPdfPath = await updatePdfWithAllSignatures(document.pdfFile, approvalData, document.formNumber);
//           document.pdfFile = updatedPdfPath;
//           document.lastUpdated = new Date();
//         } catch (pdfError) {
//           console.error('Error updating PDF for initial Lipik:', pdfError);
//         }
        
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) return res.status(400).json({ message: "Lipik remark not found." });

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           if (!doc.signatures) doc.signatures = {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF with new role signature
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role}:`, pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF for new document with non-Lipik role
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role} new doc:`, pdfError);
//             }
//           }
          
//           lipik.documents.push(newDoc);
//         }
//       }

//       report.reportingRemarks.push(remarkObj);
//     }

//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward));
//     await report.save();

//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };

// =======================================================


// // Main controller
// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;
//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");

//     if (missingFields.length) return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });

//     const formNumber = await generateFormNumber(formType);
//     let document = null;

//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) return res.status(400).json({ message: "Invalid base64 PDF." });
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // PDF Update Function - Inline
//     const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum) => {
//       try {
//         const existingPdfBytes = fs.readFileSync(pdfPath);
//         const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//         const pages = pdfDoc.getPages();
//         const firstPage = pages[0];
//         const { width, height } = firstPage.getSize();

//         // Define signature positions
//         const signaturePositions = {
//           'Lipik': { x: 50, y: height - 150 },
//           'Junior Engineer': { x: 200, y: height - 150 },
//           'Accountant': { x: 350, y: height - 150 },
//           'Assistant Municipal Commissioner': { x: 50, y: height - 250 },
//           'Dy.Municipal Commissioner': { x: 200, y: height - 250 }
//         };

//         // Add signatures for each approved role
//         for (const approval of approvalData) {
//           if (approval.signature && signaturePositions[approval.role]) {
//             const position = signaturePositions[approval.role];

//             // Add role label
//             firstPage.drawText(`${approval.role}:`, {
//               x: position.x,
//               y: position.y + 30,
//               size: 10,
//               color: PDFLib.rgb(0, 0, 0)
//             });

//             // Add status
//             firstPage.drawText(`Status: ${approval.status || 'verified'}`, {
//               x: position.x,
//               y: position.y + 15,
//               size: 8,
//               color: PDFLib.rgb(0, 0.5, 0)
//             });

//             // Add date
//             firstPage.drawText(`Date: ${new Date(approval.date).toLocaleDateString()}`, {
//               x: position.x,
//               y: position.y,
//               size: 8,
//               color: PDFLib.rgb(0, 0, 0)
//             });

//             // Add signature image if available
//             if (approval.signature && approval.signature.startsWith('data:image')) {
//               try {
//                 const signatureBase64 = approval.signature.split(',')[1];
//                 const signatureBytes = Buffer.from(signatureBase64, 'base64');

//                 let embeddedImage;
//                 if (approval.signature.includes('png')) {
//                   embeddedImage = await pdfDoc.embedPng(signatureBytes);
//                 } else if (approval.signature.includes('jpg') || approval.signature.includes('jpeg')) {
//                   embeddedImage = await pdfDoc.embedJpg(signatureBytes);
//                 }

//                 if (embeddedImage) {
//                   firstPage.drawImage(embeddedImage, {
//                     x: position.x,
//                     y: position.y - 40,
//                     width: 80,
//                     height: 30
//                   });
//                 }
//               } catch (imageError) {
//                 firstPage.drawText('Signature Applied', {
//                   x: position.x,
//                   y: position.y - 20,
//                   size: 8,
//                   color: PDFLib.rgb(0, 0, 0.8)
//                 });
//               }
//             } else {
//               firstPage.drawText('Signature Applied', {
//                 x: position.x,
//                 y: position.y - 20,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0, 0.8)
//               });
//             }
//           }
//         }

//         const pdfBytes = await pdfDoc.save();
//         const updatedPdfPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//         fs.writeFileSync(updatedPdfPath, pdfBytes);
//         return updatedPdfPath;
//       } catch (error) {
//         console.error('Error updating PDF:', error);
//         throw error;
//       }
//     };

//     // Create approval data from reporting remarks - FIXED TO INCLUDE HEAD OFFICE JE
//     const createApprovalData = (reportingRemarks, targetWard) => {
//       return reportingRemarks
//         .filter(remark => {
//           // Include remarks for the target ward OR Head Office Junior Engineers
//           return remark.ward === targetWard || 
//                  remark.userWard === targetWard || 
//                  (remark.role === "Junior Engineer" && remark.userWard === "Head Office");
//         })
//         .map(remark => ({
//           role: remark.role,
//           remark: remark.remark,
//           signature: remark.signature,
//           date: remark.date,
//           status: remark.remark === 'Approved' ? 'verified' : 'pending',
//           ward: remark.ward || remark.userWard
//         }))
//         .sort((a, b) => {
//           const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//           return hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role);
//         });
//     };

//     let report;

//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r => r.userId.toString() === userId && r.role === "Junior Engineer" && (r.ward === "Head Office" || r.userWard === "Head Office"));

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
              
//               // Update PDF with Head Office JE signature
//               try {
//                 const approvalData = createApprovalData([...report.reportingRemarks, jeRemark], wardName);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error('Error updating PDF for Head Office JE:', pdfError);
//               }
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) report = new Report({ seleMonth, ward, monthReport: seleMonth, reportingRemarks: [] });

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     // Hierarchy checks
//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(report, checkRole, checkRole === "Junior Engineer" ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w)) : ward, userId);
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r => r.userId.toString() === userId && r.role === role && (r.ward === ward || r.userWard === ward));

//     if (index !== -1) {
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for updated document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik update:', pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for new document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik new:', pdfError);
//             }
//           }
          
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       // Update PDF for all approved roles
//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
              
//               // Update PDF with current role signature
//               try {
//                 const approvalData = createApprovalData(report.reportingRemarks, ward);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error(`Error updating PDF for ${role}:`, pdfError);
//               }
//             }
//           }
//         }
//       }

//       report.reportingRemarks[index] = existing;
//     } else {
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
        
//         // Update PDF with initial Lipik signature
//         try {
//           const approvalData = createApprovalData([remarkObj], ward);
//           const updatedPdfPath = await updatePdfWithAllSignatures(document.pdfFile, approvalData, document.formNumber);
//           document.pdfFile = updatedPdfPath;
//           document.lastUpdated = new Date();
//         } catch (pdfError) {
//           console.error('Error updating PDF for initial Lipik:', pdfError);
//         }
        
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) return res.status(400).json({ message: "Lipik remark not found." });

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           if (!doc.signatures) doc.signatures = {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF with new role signature
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role}:`, pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF for new document with non-Lipik role
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role} new doc:`, pdfError);
//             }
//           }
          
//           lipik.documents.push(newDoc);
//         }
//       }

//       report.reportingRemarks.push(remarkObj);
//     }

//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward));
//     await report.save();

//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };

// ============================================================

// // // Main controller
// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;
//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");

//     if (missingFields.length) return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });

//     const formNumber = await generateFormNumber(formType);
//     let document = null;

//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) return res.status(400).json({ message: "Invalid base64 PDF." });
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // PDF Update Function - Modified to handle BOTH Junior Engineers
//     const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum) => {
//       try {
//         const existingPdfBytes = fs.readFileSync(pdfPath);
//         const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//         const pages = pdfDoc.getPages();
//         const firstPage = pages[0];
//         const { width, height } = firstPage.getSize();

//         // Define signature positions - SEPARATE positions for BOTH Junior Engineers
//         const signaturePositions = {
//           'Lipik': { x: 50, y: height - 150 },
//           'Junior Engineer_Ward': { x: 200, y: height - 150 },
//           'Junior Engineer_Head Office': { x: 350, y: height - 150 },
//           'Accountant': { x: 50, y: height - 250 },
//           'Assistant Municipal Commissioner': { x: 200, y: height - 250 },
//           'Dy.Municipal Commissioner': { x: 350, y: height - 250 }
//         };

//         // Add signatures for each approved role
//         for (const approval of approvalData) {
//           if (approval.signature) {
//             let positionKey = approval.role;
            
//             // Handle BOTH Junior Engineer positions based on userWard
//             if (approval.role === 'Junior Engineer') {
//               if (approval.userWard === 'Head Office') {
//                 positionKey = 'Junior Engineer_Head Office';
//               } else {
//                 positionKey = 'Junior Engineer_Ward';
//               }
//             }
            
//             const position = signaturePositions[positionKey];
            
//             if (position) {
//               // Add role label with ward info for Junior Engineers
//               let roleLabel = approval.role;
//               if (approval.role === 'Junior Engineer') {
//                 if (approval.userWard === 'Head Office') {
//                   roleLabel = 'JE (Head Office)';
//                 } else {
//                   roleLabel = `JE (${approval.ward || approval.userWard})`;
//                 }
//               }
              
//               firstPage.drawText(`${roleLabel}:`, {
//                 x: position.x,
//                 y: position.y + 30,
//                 size: 10,
//                 color: PDFLib.rgb(0, 0, 0)
//               });

//               // Add status
//               firstPage.drawText(`Status: ${approval.status || 'verified'}`, {
//                 x: position.x,
//                 y: position.y + 15,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0.5, 0)
//               });

//               // Add date
//               firstPage.drawText(`Date: ${new Date(approval.date).toLocaleDateString()}`, {
//                 x: position.x,
//                 y: position.y,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0, 0)
//               });

//               // Add signature image if available
//               if (approval.signature && approval.signature.startsWith('data:image')) {
//                 try {
//                   const signatureBase64 = approval.signature.split(',')[1];
//                   const signatureBytes = Buffer.from(signatureBase64, 'base64');

//                   let embeddedImage;
//                   if (approval.signature.includes('png')) {
//                     embeddedImage = await pdfDoc.embedPng(signatureBytes);
//                   } else if (approval.signature.includes('jpg') || approval.signature.includes('jpeg')) {
//                     embeddedImage = await pdfDoc.embedJpg(signatureBytes);
//                   }

//                   if (embeddedImage) {
//                     firstPage.drawImage(embeddedImage, {
//                       x: position.x,
//                       y: position.y - 40,
//                       width: 80,
//                       height: 30
//                     });
//                   }
//                 } catch (imageError) {
//                   firstPage.drawText('Signature Applied', {
//                     x: position.x,
//                     y: position.y - 20,
//                     size: 8,
//                     color: PDFLib.rgb(0, 0, 0.8)
//                   });
//                 }
//               } else {
//                 firstPage.drawText('Signature Applied', {
//                   x: position.x,
//                   y: position.y - 20,
//                   size: 8,
//                   color: PDFLib.rgb(0, 0, 0.8)
//                 });
//               }
//             }
//           }
//         }

//         const pdfBytes = await pdfDoc.save();
//         const updatedPdfPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//         fs.writeFileSync(updatedPdfPath, pdfBytes);
//         return updatedPdfPath;
//       } catch (error) {
//         console.error('Error updating PDF:', error);
//         throw error;
//       }
//     };

//     // Create approval data from reporting remarks - INCLUDES BOTH Junior Engineers
//     const createApprovalData = (reportingRemarks, targetWard,seleMonth, wardName) => {
//       return reportingRemarks
//         .filter(remark => {
//           // Include remarks for the target ward OR Head Office Junior Engineers
//           return remark.ward === targetWard || 
//                  remark.userWard === targetWard || 
//                  (remark.role === "Junior Engineer" && remark.userWard === "Head Office");
//         })
//         .map(remark => ({
//           role: remark.role,
//           remark: remark.remark,
//           signature: remark.signature,
//           date: remark.date,
//           status: remark.remark === 'Approved' ? 'verified' : 'pending',
//           ward: remark.ward,
//           userWard: remark.userWard,
//           seleMonth: seleMonth,     // ✅ newly added
//           wardName: targetWard       // ✅ newly added
//         }))
//         .sort((a, b) => {
//           const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//           return hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role);
//         });
//     };

//     let report;

//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r => r.userId.toString() === userId && r.role === "Junior Engineer" && (r.ward === "Head Office" || r.userWard === "Head Office"));

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
              
//               // Update PDF with Head Office JE signature
//               try {
//                 const approvalData = createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth,wardName);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error('Error updating PDF for Head Office JE:', pdfError);
//               }
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) report = new Report({ seleMonth, ward, monthReport: seleMonth, reportingRemarks: [] });

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     // Hierarchy checks
//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(report, checkRole, checkRole === "Junior Engineer" ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w)) : ward, userId);
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r => r.userId.toString() === userId && r.role === role && (r.ward === ward || r.userWard === ward));

//     if (index !== -1) {
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for updated document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik update:', pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for new document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik new:', pdfError);
//             }
//           }
          
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       // Update PDF for all approved roles
//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
              
//               // Update PDF with current role signature
//               try {
//                 const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, wardName);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error(`Error updating PDF for ${role}:`, pdfError);
//               }
//             }
//           }
//         }
//       }

//       report.reportingRemarks[index] = existing;
//     } else {
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
        
//         // Update PDF with initial Lipik signature
//         try {
//           const approvalData = createApprovalData([remarkObj], ward);
//           const updatedPdfPath = await updatePdfWithAllSignatures(document.pdfFile, approvalData, document.formNumber);
//           document.pdfFile = updatedPdfPath;
//           document.lastUpdated = new Date();
//         } catch (pdfError) {
//           console.error('Error updating PDF for initial Lipik:', pdfError);
//         }
        
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) return res.status(400).json({ message: "Lipik remark not found." });

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           if (!doc.signatures) doc.signatures = {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF with new role signature
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role}:`, pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF for new document with non-Lipik role
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role} new doc:`, pdfError);
//             }
//           }
          
//           lipik.documents.push(newDoc);
//         }
//       }

//       report.reportingRemarks.push(remarkObj);
//     }

//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward));
//     await report.save();

//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };
// =========================================================================

// Main controller
// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;
//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");

//     if (missingFields.length) return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });

//     const formNumber = await generateFormNumber(formType);
//     let document = null;

//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) return res.status(400).json({ message: "Invalid base64 PDF." });
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // PDF Update Function - Modified to handle BOTH Junior Engineers and display ward & seleMonth
//     const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum) => {
//       try {
//         const existingPdfBytes = fs.readFileSync(pdfPath);
//         const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//         const pages = pdfDoc.getPages();
//         const firstPage = pages[0];
//         const { width, height } = firstPage.getSize();

//         // Define signature positions - SEPARATE positions for BOTH Junior Engineers
//         const signaturePositions = {
//           'Lipik': { x: 50, y: height - 150 },
//           'Junior Engineer_Ward': { x: 200, y: height - 150 },
//           'Junior Engineer_Head Office': { x: 350, y: height - 150 },
//           'Accountant': { x: 50, y: height - 250 },
//           'Assistant Municipal Commissioner': { x: 200, y: height - 250 },
//           'Dy.Municipal Commissioner': { x: 350, y: height - 250 }
//         };

//         // Add signatures for each approved role
//         for (const approval of approvalData) {
//           if (approval.signature) {
//             let positionKey = approval.role;
            
//             // Handle BOTH Junior Engineer positions based on userWard
//             if (approval.role === 'Junior Engineer') {
//               if (approval.userWard === 'Head Office') {
//                 positionKey = 'Junior Engineer_Head Office';
//               } else {
//                 positionKey = 'Junior Engineer_Ward';
//               }
//             }
            
//             const position = signaturePositions[positionKey];
            
//             if (position) {
//               // Add role label with ward info for Junior Engineers
//               let roleLabel = approval.role;
//               if (approval.role === 'Junior Engineer') {
//                 if (approval.userWard === 'Head Office') {
//                   roleLabel = 'JE (Head Office)';
//                 } else {
//                   roleLabel = `JE (${approval.ward || approval.userWard})`;
//                 }
//               }
              
//               firstPage.drawText(`${roleLabel}:`, {
//                 x: position.x,
//                 y: position.y + 50,
//                 size: 10,
//                 color: PDFLib.rgb(0, 0, 0)
//               });

//               // Add status
//               firstPage.drawText(`Status: ${approval.status || 'verified'}`, {
//                 x: position.x,
//                 y: position.y + 35,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0.5, 0)
//               });

//               // Add ward ✅ newly added
//               firstPage.drawText(`Ward: ${approval.ward || approval.userWard || 'N/A'}`, {
//                 x: position.x,
//                 y: position.y + 20,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0, 0)
//               });

//               // Add seleMonth ✅ newly added
//               firstPage.drawText(`Month: ${approval.seleMonth || 'N/A'}`, {
//                 x: position.x,
//                 y: position.y + 5,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0, 0)
//               });

//               // Add date
//               firstPage.drawText(`Date: ${new Date(approval.date).toLocaleDateString()}`, {
//                 x: position.x,
//                 y: position.y - 10,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0, 0)
//               });

//               // Add signature image if available
//               if (approval.signature && approval.signature.startsWith('data:image')) {
//                 try {
//                   const signatureBase64 = approval.signature.split(',')[1];
//                   const signatureBytes = Buffer.from(signatureBase64, 'base64');

//                   let embeddedImage;
//                   if (approval.signature.includes('png')) {
//                     embeddedImage = await pdfDoc.embedPng(signatureBytes);
//                   } else if (approval.signature.includes('jpg') || approval.signature.includes('jpeg')) {
//                     embeddedImage = await pdfDoc.embedJpg(signatureBytes);
//                   }

//                   if (embeddedImage) {
//                     firstPage.drawImage(embeddedImage, {
//                       x: position.x,
//                       y: position.y - 50,
//                       width: 80,
//                       height: 30
//                     });
//                   }
//                 } catch (imageError) {
//                   firstPage.drawText('Signature Applied', {
//                     x: position.x,
//                     y: position.y - 30,
//                     size: 8,
//                     color: PDFLib.rgb(0, 0, 0.8)
//                   });
//                 }
//               } else {
//                 firstPage.drawText('Signature Applied', {
//                   x: position.x,
//                   y: position.y - 30,
//                   size: 8,
//                   color: PDFLib.rgb(0, 0, 0.8)
//                 });
//               }
//             }
//           }
//         }

//         const pdfBytes = await pdfDoc.save();
//         const updatedPdfPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//         fs.writeFileSync(updatedPdfPath, pdfBytes);
//         return updatedPdfPath;
//       } catch (error) {
//         console.error('Error updating PDF:', error);
//         throw error;
//       }
//     };

//     // Create approval data from reporting remarks - INCLUDES BOTH Junior Engineers
//     const createApprovalData = (reportingRemarks, targetWard, seleMonth, wardName) => {
//       return reportingRemarks
//         .filter(remark => {
//           // Include remarks for the target ward OR Head Office Junior Engineers
//           return remark.ward === targetWard || 
//                  remark.userWard === targetWard || 
//                  (remark.role === "Junior Engineer" && remark.userWard === "Head Office");
//         })
//         .map(remark => ({
//           role: remark.role,
//           remark: remark.remark,
//           signature: remark.signature,
//           date: remark.date,
//           status: remark.remark === 'Approved' ? 'verified' : 'pending',
//           ward: remark.ward,
//           userWard: remark.userWard,
//           seleMonth: seleMonth,     // ✅ newly added
//           wardName: targetWard       // ✅ newly added
//         }))
//         .sort((a, b) => {
//           const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//           return hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role);
//         });
//     };

//     let report;

//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r => r.userId.toString() === userId && r.role === "Junior Engineer" && (r.ward === "Head Office" || r.userWard === "Head Office"));

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
              
//               // Update PDF with Head Office JE signature
//               try {
//                 const approvalData = createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth, wardName);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error('Error updating PDF for Head Office JE:', pdfError);
//               }
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) report = new Report({ seleMonth, ward, monthReport: seleMonth, reportingRemarks: [] });

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     // Hierarchy checks
//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(report, checkRole, checkRole === "Junior Engineer" ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w)) : ward, userId);
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r => r.userId.toString() === userId && r.role === role && (r.ward === ward || r.userWard === ward));

//     if (index !== -1) {
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for updated document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, wardName);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik update:', pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for new document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, wardName);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik new:', pdfError);
//             }
//           }
          
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       // Update PDF for all approved roles
//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
              
//               // Update PDF with current role signature
//               try {
//                 const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, wardName);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error(`Error updating PDF for ${role}:`, pdfError);
//               }
//             }
//           }
//         }
//       }

//       report.reportingRemarks[index] = existing;
//     } else {
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
        
//         // Update PDF with initial Lipik signature
//         try {
//           const approvalData = createApprovalData([remarkObj], ward, seleMonth, wardName);
//           const updatedPdfPath = await updatePdfWithAllSignatures(document.pdfFile, approvalData, document.formNumber);
//           document.pdfFile = updatedPdfPath;
//           document.lastUpdated = new Date();
//         } catch (pdfError) {
//           console.error('Error updating PDF for initial Lipik:', pdfError);
//         }
        
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) return res.status(400).json({ message: "Lipik remark not found." });

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           if (!doc.signatures) doc.signatures = {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF with new role signature
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role}:`, pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF for new document with non-Lipik role
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role} new doc:`, pdfError);
//             }
//           }
          
//           lipik.documents.push(newDoc);
//         }
//       }

//       report.reportingRemarks.push(remarkObj);
//     }

//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward));
//     await report.save();

//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };

// ----------------------------------------------------------------------------------------


// ------------------------------------


// ========================================================================================
// Main controller
// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;
//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");

//     if (missingFields.length) return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });

//     const formNumber = await generateFormNumber(formType);
//     let document = null;

//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) return res.status(400).json({ message: "Invalid base64 PDF." });
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // PDF Update Function - Modified to handle BOTH Junior Engineers and display ward & seleMonth
//     const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
//       try {
//         const existingPdfBytes = fs.readFileSync(pdfPath);
//         const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//         const pages = pdfDoc.getPages();
//         const firstPage = pages[0];
//         const { width, height } = firstPage.getSize();


        

//         // Define signature positions - SEPARATE positions for BOTH Junior Engineers
//         const signaturePositions = {
//           'Lipik': { x: 50, y: height - 150 },
//           'Junior Engineer_Ward': { x: 200, y: height - 150 },
//           'Junior Engineer_Head Office': { x: 350, y: height - 150 },
//           'Accountant': { x: 50, y: height - 250 },
//           'Assistant Municipal Commissioner': { x: 200, y: height - 250 },
//           'Dy.Municipal Commissioner': { x: 350, y: height - 250 }
//         };

//         // Add signatures for each approved role
//         for (const approval of approvalData) {
//           if (approval.signature) {
//             let positionKey = approval.role;
            
//             // Handle BOTH Junior Engineer positions based on userWard
//             if (approval.role === 'Junior Engineer') {
//               if (approval.userWard === 'Head Office') {
//                 positionKey = 'Junior Engineer_Head Office';
//               } else {
//                 positionKey = 'Junior Engineer_Ward';
//               }
//             }
            
//             const position = signaturePositions[positionKey];
            
//             if (position) {
//               // Add role label with ward info for Junior Engineers
//               let roleLabel = approval.role;
//               if (approval.role === 'Junior Engineer') {
//                 if (approval.userWard === 'Head Office') {
//                   // Display wardName for Head Office JE to show which ward they're approving for
//                   roleLabel = `JE (Head Office) - ${targetWardName || wardName || 'Ward'}`;
//                 } else {
//                   roleLabel = `JE (${approval.ward || approval.userWard})`;
//                 }
//               }
              
//               firstPage.drawText(`${roleLabel}:`, {
//                 x: position.x,
//                 y: position.y + 50,
//                 size: 10,
//                 color: PDFLib.rgb(0, 0, 0)
//               });

//               // Add status
//               firstPage.drawText(`Status: ${approval.status || 'verified'}`, {
//                 x: position.x,
//                 y: position.y + 35,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0.5, 0)
//               });

//               // Add ward - For Head Office JE, show the target ward they're approving for
//               let displayWard = approval.ward || approval.userWard || 'N/A';
//               if (approval.role === 'Junior Engineer' && approval.userWard === 'Head Office') {
//                 displayWard = `${targetWardName || wardName || 'Ward'} (via Head Office)`;
//               }
//               firstPage.drawText(`Ward: ${displayWard}`, {
//                 x: position.x,
//                 y: position.y + 20,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0, 0)
//               });

//               // Add seleMonth
//               firstPage.drawText(`Month: ${approval.seleMonth || 'N/A'}`, {
//                 x: position.x,
//                 y: position.y + 5,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0, 0)
//               });

//               // Add date
//               firstPage.drawText(`Date: ${new Date(approval.date).toLocaleDateString()}`, {
//                 x: position.x,
//                 y: position.y - 10,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0, 0)
//               });

//               // Add signature image if available
//               if (approval.signature && approval.signature.startsWith('data:image')) {
//                 try {
//                   const signatureBase64 = approval.signature.split(',')[1];
//                   const signatureBytes = Buffer.from(signatureBase64, 'base64');

//                   let embeddedImage;
//                   if (approval.signature.includes('png')) {
//                     embeddedImage = await pdfDoc.embedPng(signatureBytes);
//                   } else if (approval.signature.includes('jpg') || approval.signature.includes('jpeg')) {
//                     embeddedImage = await pdfDoc.embedJpg(signatureBytes);
//                   }

//                   if (embeddedImage) {
//                     firstPage.drawImage(embeddedImage, {
//                       x: position.x,
//                       y: position.y - 50,
//                       width: 80,
//                       height: 30
//                     });
//                   }
//                 } catch (imageError) {
//                   firstPage.drawText('Signature Applied', {
//                     x: position.x,
//                     y: position.y - 30,
//                     size: 8,
//                     color: PDFLib.rgb(0, 0, 0.8)
//                   });
//                 }
//               } else {
//                 firstPage.drawText('Signature Applied', {
//                   x: position.x,
//                   y: position.y - 30,
//                   size: 8,
//                   color: PDFLib.rgb(0, 0, 0.8)
//                 });
//               }
//             }
//           }
//         }

//         const pdfBytes = await pdfDoc.save();
//         const updatedPdfPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//         fs.writeFileSync(updatedPdfPath, pdfBytes);
//         return updatedPdfPath;
//       } catch (error) {
//         console.error('Error updating PDF:', error);
//         throw error;
//       }
//     };

//     // Create approval data from reporting remarks - INCLUDES BOTH Junior Engineers
//     const createApprovalData = (reportingRemarks, targetWard, seleMonth, wardName) => {
//       return reportingRemarks
//         .filter(remark => {
//           // Include remarks for the target ward OR Head Office Junior Engineers
//           return remark.ward === targetWard || 
//                  remark.userWard === targetWard || 
//                  (remark.role === "Junior Engineer" && remark.userWard === "Head Office");
//         })
//         .map(remark => ({
//           role: remark.role,
//           remark: remark.remark,
//           signature: remark.signature,
//           date: remark.date,
//           status: remark.remark === 'Approved' ? 'verified' : 'pending',
//           ward: remark.ward,
//           userWard: remark.userWard,
//           seleMonth: seleMonth,
//           wardName: wardName || targetWard
//         }))
//         .sort((a, b) => {
//           const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//           return hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role);
//         });
//     };

//     let report;

//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r => r.userId.toString() === userId && r.role === "Junior Engineer" && (r.ward === "Head Office" || r.userWard === "Head Office"));

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
              
//               // Update PDF with Head Office JE signature - passing wardName for display
//               try {
//                 const approvalData = createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth, wardName);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, wardName);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error('Error updating PDF for Head Office JE:', pdfError);
//               }
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) report = new Report({ seleMonth, ward, monthReport: seleMonth, reportingRemarks: [] });

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     // Hierarchy checks
//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(report, checkRole, checkRole === "Junior Engineer" ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w)) : ward, userId);
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r => r.userId.toString() === userId && r.role === role && (r.ward === ward || r.userWard === ward));

//     if (index !== -1) {
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for updated document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, wardName);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, wardName);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik update:', pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for new document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, wardName);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber, wardName);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik new:', pdfError);
//             }
//           }
          
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       // Update PDF for all approved roles
//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
              
//               // Update PDF with current role signature
//               try {
//                 const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, wardName);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, wardName);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error(`Error updating PDF for ${role}:`, pdfError);
//               }
//             }
//           }
//         }
//       }

//       report.reportingRemarks[index] = existing;
//     } else {
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
        
//         // Update PDF with initial Lipik signature
//         try {
//           const approvalData = createApprovalData([remarkObj], ward, seleMonth, wardName);
//           const updatedPdfPath = await updatePdfWithAllSignatures(document.pdfFile, approvalData, document.formNumber, wardName);
//           document.pdfFile = updatedPdfPath;
//           document.lastUpdated = new Date();
//         } catch (pdfError) {
//           console.error('Error updating PDF for initial Lipik:', pdfError);
//         }
        
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) return res.status(400).json({ message: "Lipik remark not found." });

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           if (!doc.signatures) doc.signatures = {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF with new role signature
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, wardName);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role}:`, pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF for new document with non-Lipik role
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber, wardName);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role} new doc:`, pdfError);
//             }
//           }
          
//           lipik.documents.push(newDoc);
//         }
//       }

//       report.reportingRemarks.push(remarkObj);
//     }

//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward));
//     await report.save();

//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };
// ==============================================================================================

// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;
//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");

//     if (missingFields.length) return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });

//     const formNumber = await generateFormNumber(formType);
//     let document = null;

//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) return res.status(400).json({ message: "Invalid base64 PDF." });
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // PDF Update Function - IMPROVED POSITIONING TO PREVENT OVERLAP
//     const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
//       try {
//         const existingPdfBytes = fs.readFileSync(pdfPath);
//         const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//         const pages = pdfDoc.getPages();
//         const firstPage = pages[0];
//         const { width, height } = firstPage.getSize();

//         // ENHANCED POSITIONING SYSTEM - Single column layout for better readability
//         const approvedRoles = approvalData.filter(approval => approval.signature);
//         const startY = height - 120; // Start position from top
//         const leftMargin = 50;
//         const rightMargin = width - 50;
//         const contentWidth = rightMargin - leftMargin;

//         // Calculate dynamic section height based on content
//         const baseSectionHeight = 140; // Minimum height per section
//         const lineHeight = 12; // Height per line of text
//         const signatureHeight = 35; // Space for signature
//         const separatorHeight = 15; // Space for separator line

//         let currentY = startY;
//         let currentPage = firstPage;
//         let pageIndex = 0;

//         // Sort approvals according to hierarchy for proper display order
//         const hierarchyOrder = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//         const sortedApprovals = approvedRoles.sort((a, b) => {
//           const indexA = hierarchyOrder.indexOf(a.role);
//           const indexB = hierarchyOrder.indexOf(b.role);
//           return indexA - indexB;
//         });

//         for (let i = 0; i < sortedApprovals.length; i++) {
//           const approval = sortedApprovals[i];
          
//           // Calculate required height for this approval section
//           let requiredHeight = baseSectionHeight;
          
//           // Role label with ward info
//           let roleLabel = approval.role;
//           if (approval.role === 'Junior Engineer') {
//             if (approval.userWard === 'Head Office') {
//               roleLabel = `JE (Head Office) - ${targetWardName || wardName || 'Ward'}`;
//             } else {
//               roleLabel = `JE (${approval.ward || approval.userWard})`;
//             }
//           }
          
//           // Check if we need a new page
//           if (currentY - requiredHeight < 100) {
//             // Add new page
//             currentPage = pdfDoc.addPage([width, height]);
//             pages.push(currentPage);
//             currentY = startY;
//             pageIndex++;
//           }

//           // Draw approval section background (optional - for better visual separation)
//           currentPage.drawRectangle({
//             x: leftMargin - 5,
//             y: currentY - requiredHeight + 20,
//             width: contentWidth + 10,
//             height: requiredHeight - 20,
//             borderColor: PDFLib.rgb(0.9, 0.9, 0.9),
//             borderWidth: 1,
//             color: PDFLib.rgb(0.98, 0.98, 0.98)
//           });

//           // Draw role header with bold font
//           currentPage.drawText(`${roleLabel}:`, {
//             x: leftMargin,
//             y: currentY,
//             size: 11,
//             color: PDFLib.rgb(0, 0, 0),
//             font: await pdfDoc.embedFont('Helvetica-Bold')
//           });

//           // Draw status with appropriate color
//           const statusColor = approval.status === 'verified' ? PDFLib.rgb(0, 0.6, 0) : PDFLib.rgb(0.8, 0.4, 0);
//           currentPage.drawText(`Status: ${approval.status || 'verified'}`, {
//             x: leftMargin,
//             y: currentY - (lineHeight * 1.5),
//             size: 9,
//             color: statusColor
//           });

//           // Draw ward info
//           let displayWard = approval.ward || approval.userWard || 'N/A';
//           if (approval.role === 'Junior Engineer' && approval.userWard === 'Head Office') {
//             displayWard = `${targetWardName || wardName || 'Ward'} (via Head Office)`;
//           }
//           currentPage.drawText(`Ward: ${displayWard}`, {
//             x: leftMargin,
//             y: currentY - (lineHeight * 3),
//             size: 9,
//             color: PDFLib.rgb(0, 0, 0)
//           });

//           // Draw month
//           currentPage.drawText(`Month: ${approval.seleMonth || 'N/A'}`, {
//             x: leftMargin,
//             y: currentY - (lineHeight * 4.5),
//             size: 9,
//             color: PDFLib.rgb(0, 0, 0)
//           });

//           // Draw date
//           currentPage.drawText(`Date: ${new Date(approval.date).toLocaleDateString()}`, {
//             x: leftMargin,
//             y: currentY - (lineHeight * 6),
//             size: 9,
//             color: PDFLib.rgb(0, 0, 0)
//           });

//           // Draw remark if available
//           if (approval.remark && approval.remark !== 'Approved') {
//             currentPage.drawText(`Remark: ${approval.remark}`, {
//               x: leftMargin,
//               y: currentY - (lineHeight * 7.5),
//               size: 9,
//               color: PDFLib.rgb(0.2, 0.2, 0.2)
//             });
//           }

//           // Draw signature
//           const signatureY = currentY - (lineHeight * 9);
//           if (approval.signature && approval.signature.startsWith('data:image')) {
//             try {
//               const signatureBase64 = approval.signature.split(',')[1];
//               const signatureBytes = Buffer.from(signatureBase64, 'base64');

//               let embeddedImage;
//               if (approval.signature.includes('png')) {
//                 embeddedImage = await pdfDoc.embedPng(signatureBytes);
//               } else if (approval.signature.includes('jpg') || approval.signature.includes('jpeg')) {
//                 embeddedImage = await pdfDoc.embedJpg(signatureBytes);
//               }

//               if (embeddedImage) {
//                 currentPage.drawImage(embeddedImage, {
//                   x: leftMargin,
//                   y: signatureY - signatureHeight,
//                   width: 100,
//                   height: signatureHeight
//                 });
//               }
//             } catch (imageError) {
//               console.error('Error embedding signature image:', imageError);
//               currentPage.drawText('✓ Signature Applied', {
//                 x: leftMargin,
//                 y: signatureY - 15,
//                 size: 9,
//                 color: PDFLib.rgb(0, 0, 0.8)
//               });
//             }
//           } else {
//             currentPage.drawText('✓ Signature Applied', {
//               x: leftMargin,
//               y: signatureY - 15,
//               size: 9,
//               color: PDFLib.rgb(0, 0, 0.8)
//             });
//           }

//           // Draw separator line
//           const separatorY = currentY - requiredHeight + 30;
//           currentPage.drawLine({
//             start: { x: leftMargin, y: separatorY },
//             end: { x: rightMargin, y: separatorY },
//             thickness: 1,
//             color: PDFLib.rgb(0.7, 0.7, 0.7)
//           });

//           // Update Y position for next approval section
//           currentY -= requiredHeight;
//         }

//         const pdfBytes = await pdfDoc.save();
//         const updatedPdfPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//         fs.writeFileSync(updatedPdfPath, pdfBytes);
//         return updatedPdfPath;
//       } catch (error) {
//         console.error('Error updating PDF:', error);
//         throw error;
//       }
//     };

//     // Create approval data from reporting remarks - WARD SPECIFIC FILTERING
//     const createApprovalData = (reportingRemarks, targetWard, seleMonth, wardName) => {
//       return reportingRemarks
//         .filter(remark => {
//           // STRICT WARD FILTERING: Only include remarks for the EXACT target ward
//           // OR Head Office Junior Engineers approving for this specific ward
//           if (remark.role === "Junior Engineer" && remark.userWard === "Head Office") {
//             // Head Office JE can approve, but only for the specific target ward
//             return true;
//           }
//           // For all other roles, they must belong to the exact same ward
//           return remark.ward === targetWard || remark.userWard === targetWard;
//         })
//         .map(remark => ({
//           role: remark.role,
//           remark: remark.remark,
//           signature: remark.signature,
//           date: remark.date,
//           status: remark.remark === 'Approved' ? 'verified' : 'pending',
//           ward: remark.ward,
//           userWard: remark.userWard,
//           seleMonth: seleMonth,
//           wardName: wardName || targetWard
//         }))
//         .sort((a, b) => {
//           const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//           return hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role);
//         });
//     };

//     let report;

//     // Handle Head Office Junior Engineer approving for specific ward
//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       // Find the report for the specific ward they're approving
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       // Check if Ward JE has approved all forms for this specific ward
//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r => r.userId.toString() === userId && r.role === "Junior Engineer" && (r.ward === "Head Office" || r.userWard === "Head Office"));

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
              
//               // Update PDF with Head Office JE signature - passing wardName for display
//               try {
//                 const approvalData = createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth, wardName);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, wardName);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error('Error updating PDF for Head Office JE:', pdfError);
//               }
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     // Handle regular ward-specific operations
//     // STRICT WARD ISOLATION: Only find/create reports for the exact ward
//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) {
//       // Create new report ONLY for this specific ward
//       report = new Report({ 
//         seleMonth, 
//         ward, 
//         monthReport: seleMonth, 
//         reportingRemarks: [] 
//       });
//     }

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     // Hierarchy checks - WARD SPECIFIC
//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         // Special case for Accountant: needs both Ward JE and Head Office JE approval
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(report, checkRole, checkRole === "Junior Engineer" ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w)) : ward, userId);
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     // Find existing remark for this user, role, and ward
//     const index = report.reportingRemarks.findIndex(r => r.userId.toString() === userId && r.role === role && (r.ward === ward || r.userWard === ward));

//     if (index !== -1) {
//       // Update existing remark
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for updated document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, ward);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik update:', pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for new document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber, ward);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik new:', pdfError);
//             }
//           }
          
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       // Update PDF for all approved roles
//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
              
//               // Update PDF with current role signature
//               try {
//                 const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, ward);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, ward);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error(`Error updating PDF for ${role}:`, pdfError);
//               }
//             }
//           }
//         }
//       }

//       report.reportingRemarks[index] = existing;
//     } else {
//       // Create new remark
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
        
//         // Update PDF with initial Lipik signature
//         try {
//           const approvalData = createApprovalData([remarkObj], ward, seleMonth, ward);
//           const updatedPdfPath = await updatePdfWithAllSignatures(document.pdfFile, approvalData, document.formNumber, ward);
//           document.pdfFile = updatedPdfPath;
//           document.lastUpdated = new Date();
//         } catch (pdfError) {
//           console.error('Error updating PDF for initial Lipik:', pdfError);
//         }
        
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) return res.status(400).json({ message: "Lipik remark not found." });

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           if (!doc.signatures) doc.signatures = {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF with new role signature
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, ward);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role}:`, pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF for new document with non-Lipik role
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber, ward);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role} new doc:`, pdfError);
//             }
//           }
          
//           lipik.documents.push(newDoc);
//         }
//       }

//       report.reportingRemarks.push(remarkObj);
//     }

//     // Final update of doneBy arrays for all documents
//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward));
    
//     await report.save();

//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };

// =============================

// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;
//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");

//     if (missingFields.length) return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });

//     const formNumber = await generateFormNumber(formType);
//     let document = null;

//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) return res.status(400).json({ message: "Invalid base64 PDF." });
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // PDF Update Function - DYNAMIC POSITIONING TO PREVENT OVERLAP
//     const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
//       try {
//         const existingPdfBytes = fs.readFileSync(pdfPath);
//         const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//         const pages = pdfDoc.getPages();
//         const firstPage = pages[0];
//         const { width, height } = firstPage.getSize();

//         // DYNAMIC POSITIONING SYSTEM - Calculate positions based on approved roles count
//         const approvedRoles = approvalData.filter(approval => approval.signature);
//         const startY = height - 100; // Start from top
//         const sectionHeight = 120; // Height for each role section
//         const leftMargin = 50;
//         const rightMargin = width - 300;

//         // Create dynamic positions based on hierarchy and approval order
//         let currentY = startY;
//         let isLeftColumn = true;

//         for (let i = 0; i < approvedRoles.length; i++) {
//           const approval = approvedRoles[i];
          
//           // Calculate X position (alternate between left and right)
//           const xPosition = isLeftColumn ? leftMargin : rightMargin;
          
//           // Role label with ward info
//           let roleLabel = approval.role;
//           if (approval.role === 'Junior Engineer') {
//             if (approval.userWard === 'Head Office') {
//               roleLabel = `JE (Head Office) - ${targetWardName || wardName || 'Ward'}`;
//             } else {
//               roleLabel = `JE (${approval.ward || approval.userWard})`;
//             }
//           }
          
//           // Draw role header
//           firstPage.drawText(`${roleLabel}:`, {
//             x: xPosition,
//             y: currentY,
//             size: 10,
//             color: PDFLib.rgb(0, 0, 0),
//             font: await pdfDoc.embedFont('Helvetica-Bold')
//           });

//           // Draw status
//           firstPage.drawText(`Status: ${approval.status || 'verified'}`, {
//             x: xPosition,
//             y: currentY - 15,
//             size: 8,
//             color: PDFLib.rgb(0, 0.5, 0)
//           });

//           // Draw ward info
//           let displayWard = approval.ward || approval.userWard || 'N/A';
//           if (approval.role === 'Junior Engineer' && approval.userWard === 'Head Office') {
//             displayWard = `${targetWardName || wardName || 'Ward'} (via Head Office)`;
//           }
//           firstPage.drawText(`Ward: ${displayWard}`, {
//             x: xPosition,
//             y: currentY - 30,
//             size: 8,
//             color: PDFLib.rgb(0, 0, 0)
//           });

//           // Draw month
//           firstPage.drawText(`Month: ${approval.seleMonth || 'N/A'}`, {
//             x: xPosition,
//             y: currentY - 45,
//             size: 8,
//             color: PDFLib.rgb(0, 0, 0)
//           });

//           // Draw date
//           firstPage.drawText(`Date: ${new Date(approval.date).toLocaleDateString()}`, {
//             x: xPosition,
//             y: currentY - 60,
//             size: 8,
//             color: PDFLib.rgb(0, 0, 0)
//           });

//           // Draw signature
//           if (approval.signature && approval.signature.startsWith('data:image')) {
//             try {
//               const signatureBase64 = approval.signature.split(',')[1];
//               const signatureBytes = Buffer.from(signatureBase64, 'base64');

//               let embeddedImage;
//               if (approval.signature.includes('png')) {
//                 embeddedImage = await pdfDoc.embedPng(signatureBytes);
//               } else if (approval.signature.includes('jpg') || approval.signature.includes('jpeg')) {
//                 embeddedImage = await pdfDoc.embedJpg(signatureBytes);
//               }

//               if (embeddedImage) {
//                 firstPage.drawImage(embeddedImage, {
//                   x: xPosition,
//                   y: currentY - 100,
//                   width: 80,
//                   height: 30
//                 });
//               }
//             } catch (imageError) {
//               firstPage.drawText('Signature Applied', {
//                 x: xPosition,
//                 y: currentY - 85,
//                 size: 8,
//                 color: PDFLib.rgb(0, 0, 0.8)
//               });
//             }
//           } else {
//             firstPage.drawText('Signature Applied', {
//               x: xPosition,
//               y: currentY - 85,
//               size: 8,
//               color: PDFLib.rgb(0, 0, 0.8)
//             });
//           }

//           // Draw separator line
//           firstPage.drawLine({
//             start: { x: xPosition, y: currentY - 110 },
//             end: { x: xPosition + 200, y: currentY - 110 },
//             thickness: 1,
//             color: PDFLib.rgb(0.8, 0.8, 0.8)
//           });

//           // Update position for next signature
//           if (isLeftColumn) {
//             // Move to right column
//             isLeftColumn = false;
//           } else {
//             // Move to next row, left column
//             isLeftColumn = true;
//             currentY -= sectionHeight;
            
//             // Check if we need a new page
//             if (currentY < 100) {
//               const newPage = pdfDoc.addPage([width, height]);
//               pages.push(newPage);
//               currentY = startY;
//             }
//           }
//         }

//         const pdfBytes = await pdfDoc.save();
//         const updatedPdfPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//         fs.writeFileSync(updatedPdfPath, pdfBytes);
//         return updatedPdfPath;
//       } catch (error) {
//         console.error('Error updating PDF:', error);
//         throw error;
//       }
//     };

//     // Create approval data from reporting remarks - WARD SPECIFIC FILTERING
//     const createApprovalData = (reportingRemarks, targetWard, seleMonth, wardName) => {
//       return reportingRemarks
//         .filter(remark => {
//           // STRICT WARD FILTERING: Only include remarks for the EXACT target ward
//           // OR Head Office Junior Engineers approving for this specific ward
//           if (remark.role === "Junior Engineer" && remark.userWard === "Head Office") {
//             // Head Office JE can approve, but only for the specific target ward
//             return true;
//           }
//           // For all other roles, they must belong to the exact same ward
//           return remark.ward === targetWard || remark.userWard === targetWard;
//         })
//         .map(remark => ({
//           role: remark.role,
//           remark: remark.remark,
//           signature: remark.signature,
//           date: remark.date,
//           status: remark.remark === 'Approved' ? 'verified' : 'pending',
//           ward: remark.ward,
//           userWard: remark.userWard,
//           seleMonth: seleMonth,
//           wardName: wardName || targetWard
//         }))
//         .sort((a, b) => {
//           const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//           return hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role);
//         });
//     };

//     let report;

//     // Handle Head Office Junior Engineer approving for specific ward
//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       // Find the report for the specific ward they're approving
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       // Check if Ward JE has approved all forms for this specific ward
//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r => r.userId.toString() === userId && r.role === "Junior Engineer" && (r.ward === "Head Office" || r.userWard === "Head Office"));

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
              
//               // Update PDF with Head Office JE signature - passing wardName for display
//               try {
//                 const approvalData = createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth, wardName);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, wardName);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error('Error updating PDF for Head Office JE:', pdfError);
//               }
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     // Handle regular ward-specific operations
//     // STRICT WARD ISOLATION: Only find/create reports for the exact ward
//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) {
//       // Create new report ONLY for this specific ward
//       report = new Report({ 
//         seleMonth, 
//         ward, 
//         monthReport: seleMonth, 
//         reportingRemarks: [] 
//       });
//     }

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     // Hierarchy checks - WARD SPECIFIC
//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         // Special case for Accountant: needs both Ward JE and Head Office JE approval
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(report, checkRole, checkRole === "Junior Engineer" ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w)) : ward, userId);
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     // Find existing remark for this user, role, and ward
//     const index = report.reportingRemarks.findIndex(r => r.userId.toString() === userId && r.role === role && (r.ward === ward || r.userWard === ward));

//     if (index !== -1) {
//       // Update existing remark
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for updated document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, ward);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik update:', pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);
          
//           // Update PDF with Lipik signature for new document
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber, ward);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error('Error updating PDF for Lipik new:', pdfError);
//             }
//           }
          
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       // Update PDF for all approved roles
//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
              
//               // Update PDF with current role signature
//               try {
//                 const approvalData = createApprovalData(report.reportingRemarks, ward, seleMonth, ward);
//                 const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, ward);
//                 doc.pdfFile = updatedPdfPath;
//                 doc.lastUpdated = new Date();
//               } catch (pdfError) {
//                 console.error(`Error updating PDF for ${role}:`, pdfError);
//               }
//             }
//           }
//         }
//       }

//       report.reportingRemarks[index] = existing;
//     } else {
//       // Create new remark
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
        
//         // Update PDF with initial Lipik signature
//         try {
//           const approvalData = createApprovalData([remarkObj], ward, seleMonth, ward);
//           const updatedPdfPath = await updatePdfWithAllSignatures(document.pdfFile, approvalData, document.formNumber, ward);
//           document.pdfFile = updatedPdfPath;
//           document.lastUpdated = new Date();
//         } catch (pdfError) {
//           console.error('Error updating PDF for initial Lipik:', pdfError);
//         }
        
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) return res.status(400).json({ message: "Lipik remark not found." });

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);

//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           if (!doc.signatures) doc.signatures = {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF with new role signature
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(doc.pdfFile, approvalData, doc.formNumber, ward);
//               doc.pdfFile = updatedPdfPath;
//               doc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role}:`, pdfError);
//             }
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
          
//           // Update PDF for new document with non-Lipik role
//           if (remark === "Approved") {
//             try {
//               const approvalData = createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, ward);
//               const updatedPdfPath = await updatePdfWithAllSignatures(newDoc.pdfFile, approvalData, newDoc.formNumber, ward);
//               newDoc.pdfFile = updatedPdfPath;
//               newDoc.lastUpdated = new Date();
//             } catch (pdfError) {
//               console.error(`Error updating PDF for ${role} new doc:`, pdfError);
//             }
//           }
          
//           lipik.documents.push(newDoc);
//         }
//       }

//       report.reportingRemarks.push(remarkObj);
//     }

//     // Final update of doneBy arrays for all documents
//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward));
    
//     await report.save();

//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };

// ===============================








// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;

//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");
//     if (missingFields.length) {
//       return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });
//     }

//     const formNumber = await generateFormNumber(formType);
//     let document = null;
//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) {
//         return res.status(400).json({ message: "Invalid base64 PDF." });
//       }
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // // PDF Signatures function updated here (new logic)
//     // const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
//     //   const existingPdfBytes = fs.readFileSync(pdfPath);
//     //   const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//     //   const { width, height } = pdfDoc.getPages()[0].getSize();

//     //   const pageCount = pdfDoc.getPageCount();
//     //   if (pageCount > 1) pdfDoc.removePage(pageCount - 1);

//     //   const page = pdfDoc.addPage([width, height]);
//     //   const titleFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
//     //   const bodyFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

//     //   page.drawText('APPROVAL SIGNATURES', { x: 50, y: height - 50, size: 18, font: titleFont });

//     //   const columns = 2;
//     //   const rows = 3;
//     //   const cellWidth = (width - 100) / columns;
//     //   const cellHeight = 140;
//     //   const startX = 50;
//     //   const startY = height - 100;

//     //   const order = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//     //   const sortedData = approvalData
//     //     .filter(a => a.signature)
//     //     .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

//     //   for (let i = 0; i < sortedData.length; i++) {
//     //     const a = sortedData[i];
//     //     const col = i % columns;
//     //     const row = Math.floor(i / columns);

//     //     const x = startX + col * cellWidth;
//     //     const y = startY - row * cellHeight;

//     //     page.drawRectangle({
//     //       x: x - 5,
//     //       y: y - cellHeight + 10,
//     //       width: cellWidth,
//     //       height: cellHeight - 20,
//     //       color: PDFLib.rgb(0.97, 0.97, 0.97)
//     //     });

//     //     page.drawText(`${a.role}:`, { x, y, size: 12, font: titleFont });
//     //     page.drawText(`Status: ${a.status}`, { x, y: y - 20, size: 10, font: bodyFont });

//     //     const wardDisplay = (a.role === 'Junior Engineer' && a.userWard === 'Head Office') ? `${targetWardName} (via Head Office)` : (a.ward || a.userWard);
//     //     page.drawText(`Ward: ${wardDisplay}`, { x, y: y - 35, size: 10, font: bodyFont });

//     //     page.drawText(`Month: ${a.seleMonth} Date: ${new Date(a.date).toLocaleDateString()}`, { x, y: y - 50, size: 10, font: bodyFont });

//     //     if (a.signature.startsWith('data:image')) {
//     //       const imgBytes = Buffer.from(a.signature.split(',')[1], 'base64');
//     //       const img = a.signature.includes('png') ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);
//     //       page.drawImage(img, { x, y: y - 100, width: 80, height: 30 });
//     //     } else {
//     //       page.drawText('✓ Signature Applied', { x, y: y - 80, size: 10, font: bodyFont });
//     //     }
//     //   }

//     //   const outBytes = await pdfDoc.save();
//     //   const updatedPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//     //   fs.writeFileSync(updatedPath, outBytes);
//     //   return updatedPath;
//     // };

//     // -----------------------

//     // PDF Signatures function updated here (new logic)
// const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
//   // 1. Load existing PDF (all pages retained)
//   const existingPdfBytes = fs.readFileSync(pdfPath);
//   const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//   const { width, height } = pdfDoc.getPages()[0].getSize();

//   // 2. Always append one new page at the end
//   const page = pdfDoc.addPage([width, height]);
//   const titleFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
//   const bodyFont  = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

//   // 3. Draw title
//   page.drawText('APPROVAL SIGNATURES', {
//     x: 50, y: height - 50, size: 18, font: titleFont
//   });

//   // 4. Grid: 2 columns × 3 rows
//   const columns   = 2;
//   const cellWidth = (width - 100) / columns;
//   const cellHeight= 140;
//   const startX    = 50;
//   const startY    = height - 100;

//   // 5. Sort & filter only approved signatures
//   const order = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//   const sortedData = approvalData
//     .filter(a => a.signature)
//     .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

//   // 6. Draw each block into grid
//   for (let i = 0; i < sortedData.length; i++) {
//     const a = sortedData[i];
//     const col = i % columns;
//     const row = Math.floor(i / columns);

//     const x = startX + col * cellWidth;
//     const y = startY - row * cellHeight;

//     // background
//     page.drawRectangle({
//       x: x - 5,
//       y: y - cellHeight + 10,
//       width: cellWidth,
//       height: cellHeight - 20,
//       color: PDFLib.rgb(0.97, 0.97, 0.97)
//     });

//     // role & status
//     page.drawText(`${a.role}:`, { x, y, size: 12, font: titleFont });
//     page.drawText(`Status: ${a.status}`, { x, y: y - 20, size: 10, font: bodyFont });

//     // ward & date
//     const wardDisplay = (a.role === 'Junior Engineer' && a.userWard === 'Head Office')
//       ? `${targetWardName} (via Head Office)` : (a.ward || a.userWard);
//     page.drawText(`Ward: ${wardDisplay}`, { x, y: y - 35, size: 10, font: bodyFont });
//     page.drawText(`Month: ${a.seleMonth} Date: ${new Date(a.date).toLocaleDateString()}`, {
//       x, y: y - 50, size: 10, font: bodyFont
//     });

//     // signature image or checkmark
//     if (a.signature.startsWith('data:image')) {
//       const imgBytes = Buffer.from(a.signature.split(',')[1], 'base64');
//       const img = a.signature.includes('png')
//         ? await pdfDoc.embedPng(imgBytes)
//         : await pdfDoc.embedJpg(imgBytes);
//       page.drawImage(img, { x, y: y - 100, width: 80, height: 30 });
//     } else {
//       page.drawText('✓ Signature Applied', { x, y: y - 80, size: 10, font: bodyFont });
//     }
//   }

//   // 7. Save out
//   const outBytes = await pdfDoc.save();
//   const updatedPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//   fs.writeFileSync(updatedPath, outBytes);
//   return updatedPath;
// };


//     const createApprovalData = (remarks, targetWard, month, wName) => {
//       const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//       return remarks
//         .filter(r => (r.role === "Junior Engineer" && r.userWard === "Head Office") || r.ward === targetWard || r.userWard === targetWard)
//         .map(r => ({
//           role: r.role,
//           remark: r.remark,
//           signature: r.signature,
//           date: r.date,
//           status: r.remark === 'Approved' ? 'verified' : 'pending',
//           ward: r.ward,
//           userWard: r.userWard,
//           seleMonth: month,
//           wardName: wName || targetWard
//         }))
//         .sort((a, b) => hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role));
//     };

//     let report;

//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r =>
//         r.userId.toString() === userId &&
//         r.role === "Junior Engineer" &&
//         (r.ward === "Head Office" || r.userWard === "Head Office")
//       );

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
//               doc.pdfFile = await updatePdfWithAllSignatures(
//                 doc.pdfFile,
//                 createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth, wardName),
//                 doc.formNumber,
//                 wardName
//               );
//               doc.lastUpdated = new Date();
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) {
//       report = new Report({
//         seleMonth,
//         ward,
//         monthReport: seleMonth,
//         reportingRemarks: []
//       });
//     }

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(
//             report,
//             checkRole,
//             checkRole === "Junior Engineer"
//               ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w))
//               : ward,
//             userId
//           );
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r =>
//       r.userId.toString() === userId &&
//       r.role === role &&
//       (r.ward === ward || r.userWard === ward)
//     );

//     if (index !== -1) {
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);
//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);

//           if (remark === "Approved") {
//             doc.pdfFile = await updatePdfWithAllSignatures(
//               doc.pdfFile,
//               createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//               doc.formNumber,
//               wardName
//             );
//             doc.lastUpdated = new Date();
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);

//           if (remark === "Approved") {
//             newDoc.pdfFile = await updatePdfWithAllSignatures(
//               newDoc.pdfFile,
//               createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//               newDoc.formNumber,
//               wardName
//             );
//             newDoc.lastUpdated = new Date();
//           }
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//               doc.pdfFile = await updatePdfWithAllSignatures(
//                 doc.pdfFile,
//                 createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//                 doc.formNumber,
//                 wardName
//               );
//               doc.lastUpdated = new Date();
//             }
//           }
//         }
//       }
//       report.reportingRemarks[index] = existing;
//     } else {
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
//         document.pdfFile = await updatePdfWithAllSignatures(
//           document.pdfFile,
//           createApprovalData([remarkObj], ward, seleMonth, wardName),
//           document.formNumber,
//           wardName
//         );
//         document.lastUpdated = new Date();
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) {
//           return res.status(400).json({ message: "Lipik remark not found." });
//         }

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);
//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           doc.signatures = doc.signatures || {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) {
//             doc.approvedBy.push(userId);
//           }
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
//           if (remark === "Approved") {
//             doc.pdfFile = await updatePdfWithAllSignatures(
//               doc.pdfFile,
//               createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
//               doc.formNumber,
//               wardName
//             );
//             doc.lastUpdated = new Date();
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
//           if (remark === "Approved") {
//             newDoc.pdfFile = await updatePdfWithAllSignatures(
//               newDoc.pdfFile,
//               createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
//               newDoc.formNumber,
//               wardName
//             );
//             newDoc.lastUpdated = new Date();
//           }
//           lipik.documents.push(newDoc);
//         }
//       }
//       report.reportingRemarks.push(remarkObj);
//     }

//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => {
//       doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//     });

//     await report.save();
//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };

// =============================



// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;

//     // 1. Validate required fields
//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");
//     if (missingFields.length) {
//       return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });
//     }

//     // 2. Prepare incoming PDF document
//     const formNumber = await generateFormNumber(formType);
//     let document = null;
//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) {
//         return res.status(400).json({ message: "Invalid base64 PDF." });
//       }
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // 3. PDF helper — append new "APPROVAL SIGNATURES" page at end
//     const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
//       const existingPdfBytes = fs.readFileSync(pdfPath);
//       const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//       const { width, height } = pdfDoc.getPages()[0].getSize();

//       const signed = approvalData.filter(a => a.signature);
//       if (signed.length) {
//         let page = pdfDoc.addPage([width, height]);
//         let y = height - 60;
//         const left = 50;
//         const titleFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
//         const bodyFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

//         page.drawText('APPROVAL SIGNATURES', { x: left, y, size: 18, font: titleFont });
//         y -= 30;

//         const order = ['Lipik','Junior Engineer','Accountant','Assistant Municipal Commissioner','Dy.Municipal Commissioner'];
//         signed.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

//         for (const a of signed) {
//           if (y < 120) {
//             page = pdfDoc.addPage([width, height]);
//             y = height - 60;
//           }
//           page.drawRectangle({
//             x: left - 5,
//             y: y - 80,
//             width: width - left * 2 + 10,
//             height: 90,
//             color: PDFLib.rgb(0.97, 0.97, 0.97)
//           });
//           page.drawText(`${a.role}:`, { x: left, y, size: 12, font: titleFont });
//           y -= 18;
//           page.drawText(`Status: ${a.status}`, { x: left, y, size: 10, font: bodyFont });
//           y -= 14;
//           const wardDisplay = (a.role === 'Junior Engineer' && a.userWard === 'Head Office')
//             ? `${targetWardName} (via Head Office)`
//             : (a.ward || a.userWard);
//           page.drawText(`Ward: ${wardDisplay}`, { x: left, y, size: 10, font: bodyFont });
//           y -= 14;
//           page.drawText(`Month: ${a.seleMonth}    Date: ${new Date(a.date).toLocaleDateString()}`, { x: left, y, size: 10, font: bodyFont });
//           y -= 14;

//           if (a.signature.startsWith('data:image')) {
//             const imgBytes = Buffer.from(a.signature.split(',')[1], 'base64');
//             const img = a.signature.includes('png')
//               ? await pdfDoc.embedPng(imgBytes)
//               : await pdfDoc.embedJpg(imgBytes);
//             page.drawImage(img, { x: left, y: y - 40, width: 100, height: 30 });
//           } else {
//             page.drawText('✓ Signature Applied', { x: left, y, size: 10, font: bodyFont });
//           }
//           y -= 60;
//         }
//       }

//       const outBytes = await pdfDoc.save();
//       const updatedPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//       fs.writeFileSync(updatedPath, outBytes);
//       return updatedPath;
//     };

//     // 4. Build approval-data array
//     const createApprovalData = (remarks, targetWard, month, wName) => {
//       const hierarchy = ['Lipik','Junior Engineer','Accountant','Assistant Municipal Commissioner','Dy.Municipal Commissioner'];
//       return remarks
//         .filter(r => (r.role === "Junior Engineer" && r.userWard === "Head Office") || r.ward === targetWard || r.userWard === targetWard)
//         .map(r => ({
//           role:      r.role,
//           remark:    r.remark,
//           signature: r.signature,
//           date:      r.date,
//           status:    r.remark === 'Approved' ? 'verified' : 'pending',
//           ward:      r.ward,
//           userWard:  r.userWard,
//           seleMonth: month,
//           wardName:  wName || targetWard
//         }))
//         .sort((a, b) => hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role));
//     };

//     // 5. === Full existing logic below ===

//     let report;

//     // Head Office JE case
//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r =>
//         r.userId.toString() === userId &&
//         r.role === "Junior Engineer" &&
//         (r.ward === "Head Office" || r.userWard === "Head Office")
//       );

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);

//               doc.pdfFile = await updatePdfWithAllSignatures(
//                 doc.pdfFile,
//                 createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth, wardName),
//                 doc.formNumber,
//                 wardName
//               );
//               doc.lastUpdated = new Date();
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     // Regular ward case
//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) {
//       report = new Report({
//         seleMonth,
//         ward,
//         monthReport: seleMonth,
//         reportingRemarks: []
//       });
//     }

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(
//             report,
//             checkRole,
//             checkRole === "Junior Engineer"
//               ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w))
//               : ward,
//             userId
//           );
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r =>
//       r.userId.toString() === userId &&
//       r.role === role &&
//       (r.ward === ward || r.userWard === ward)
//     );

//     if (index !== -1) {
//       // Update existing remark
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);
//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);

//           if (remark === "Approved") {
//             doc.pdfFile = await updatePdfWithAllSignatures(
//               doc.pdfFile,
//               createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//               doc.formNumber,
//               wardName
//             );
//             doc.lastUpdated = new Date();
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);

//           if (remark === "Approved") {
//             newDoc.pdfFile = await updatePdfWithAllSignatures(
//               newDoc.pdfFile,
//               createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//               newDoc.formNumber,
//               wardName
//             );
//             newDoc.lastUpdated = new Date();
//           }
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);

//               doc.pdfFile = await updatePdfWithAllSignatures(
//                 doc.pdfFile,
//                 createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//                 doc.formNumber,
//                 wardName
//               );
//               doc.lastUpdated = new Date();
//             }
//           }
//         }
//       }

//       report.reportingRemarks[index] = existing;

//     } else {
//       // Create new remark
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);

//         document.pdfFile = await updatePdfWithAllSignatures(
//           document.pdfFile,
//           createApprovalData([remarkObj], ward, seleMonth, wardName),
//           document.formNumber,
//           wardName
//         );
//         document.lastUpdated = new Date();
//         remarkObj.documents.push(document);

//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) {
//           return res.status(400).json({ message: "Lipik remark not found." });
//         }

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);
//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           doc.signatures = doc.signatures || {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) {
//             doc.approvedBy.push(userId);
//           }
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);

//           if (remark === "Approved") {
//             doc.pdfFile = await updatePdfWithAllSignatures(
//               doc.pdfFile,
//               createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
//               doc.formNumber,
//               wardName
//             );
//             doc.lastUpdated = new Date();
//           }

//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);

//           if (remark === "Approved") {
//             newDoc.pdfFile = await updatePdfWithAllSignatures(
//               newDoc.pdfFile,
//               createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
//               newDoc.formNumber,
//               wardName
//             );
//             newDoc.lastUpdated = new Date();
//           }
//           lipik.documents.push(newDoc);
//         }
//       }

//       report.reportingRemarks.push(remarkObj);
//     }

//     // 6. Final doneBy update & save
//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => {
//       doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//     });

//     await report.save();
//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };


// ==================================================================================
// 17 Jun
// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;

//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");
//     if (missingFields.length) {
//       return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });
//     }

//     const formNumber = await generateFormNumber(formType);
//     let document = null;
//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) {
//         return res.status(400).json({ message: "Invalid base64 PDF." });
//       }
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }
// // sagale signatures ekatra disat aahet pan second page udatoy
//     // PDF Signatures function updated here (new logic)
//     // const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
//     //   const existingPdfBytes = fs.readFileSync(pdfPath);
//     //   const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//     //   const { width, height } = pdfDoc.getPages()[0].getSize();

//     //   const pageCount = pdfDoc.getPageCount();
//     //   if (pageCount > 1) pdfDoc.removePage(pageCount - 1);

//     //   const page = pdfDoc.addPage([width, height]);
//     //   const titleFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
//     //   const bodyFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

//     //   page.drawText('APPROVAL SIGNATURES', { x: 50, y: height - 50, size: 18, font: titleFont });

//     //   const columns = 2;
//     //   const rows = 3;
//     //   const cellWidth = (width - 100) / columns;
//     //   const cellHeight = 140;
//     //   const startX = 50;
//     //   const startY = height - 100;

//     //   const order = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//     //   const sortedData = approvalData
//     //     .filter(a => a.signature)
//     //     .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

//     //   for (let i = 0; i < sortedData.length; i++) {
//     //     const a = sortedData[i];
//     //     const col = i % columns;
//     //     const row = Math.floor(i / columns);

//     //     const x = startX + col * cellWidth;
//     //     const y = startY - row * cellHeight;

//     //     page.drawRectangle({
//     //       x: x - 5,
//     //       y: y - cellHeight + 10,
//     //       width: cellWidth,
//     //       height: cellHeight - 20,
//     //       color: PDFLib.rgb(0.97, 0.97, 0.97)
//     //     });

//     //     page.drawText(`${a.role}:`, { x, y, size: 12, font: titleFont });
//     //     page.drawText(`Status: ${a.status}`, { x, y: y - 20, size: 10, font: bodyFont });

//     //     const wardDisplay = (a.role === 'Junior Engineer' && a.userWard === 'Head Office') ? `${targetWardName} (via Head Office)` : (a.ward || a.userWard);
//     //     page.drawText(`Ward: ${wardDisplay}`, { x, y: y - 35, size: 10, font: bodyFont });

//     //     page.drawText(`Month: ${a.seleMonth} Date: ${new Date(a.date).toLocaleDateString()}`, { x, y: y - 50, size: 10, font: bodyFont });

//     //     if (a.signature.startsWith('data:image')) {
//     //       const imgBytes = Buffer.from(a.signature.split(',')[1], 'base64');
//     //       const img = a.signature.includes('png') ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);
//     //       page.drawImage(img, { x, y: y - 100, width: 80, height: 30 });
//     //     } else {
//     //       page.drawText('✓ Signature Applied', { x, y: y - 80, size: 10, font: bodyFont });
//     //     }
//     //   }

//     //   const outBytes = await pdfDoc.save();
//     //   const updatedPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//     //   fs.writeFileSync(updatedPath, outBytes);
//     //   return updatedPath;
//     // };

//     // -----------------------

// //   // ya madhe approvals signature new page add hot jaat aahe 
// // const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
// //       const existingPdfBytes = fs.readFileSync(pdfPath);
// //       const pdfDoc            = await PDFLib.PDFDocument.load(existingPdfBytes);
// //       const { width, height } = pdfDoc.getPages()[0].getSize();

// //       // Append exactly one new page
// //       const page      = pdfDoc.addPage([width, height]);
// //       const titleFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
// //       const bodyFont  = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

// //       page.drawText('APPROVAL SIGNATURES', { x: 50, y: height - 50, size: 18, font: titleFont });

// //       const columns   = 2;
// //       const rows      = 3;
// //       const cellWidth = (width - 100) / columns;
// //       const cellHeight= 140;
// //       const startX    = 50;
// //       const startY    = height - 100;

// //       const order = ['Lipik','Junior Engineer','Accountant','Assistant Municipal Commissioner','Dy.Municipal Commissioner'];
// //       const sorted = approvalData
// //         .filter(a => a.signature)
// //         .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

// //       for (let i = 0; i < sorted.length && i < columns * rows; i++) {
// //         const a   = sorted[i];
// //         const col = i % columns;
// //         const row = Math.floor(i / columns);
// //         const x   = startX + col * cellWidth;
// //         const y   = startY - row * cellHeight;

// //         page.drawRectangle({
// //           x: x - 5,
// //           y: y - cellHeight + 10,
// //           width: cellWidth,
// //           height: cellHeight - 20,
// //           color: PDFLib.rgb(0.97, 0.97, 0.97)
// //         });

// //         page.drawText(`${a.role}:`, { x, y, size: 12, font: titleFont });
// //         page.drawText(`Status: ${a.status}`, { x, y: y - 20, size: 10, font: bodyFont });

// //         const wardDisp = (a.role === 'Junior Engineer' && a.userWard === 'Head Office')
// //           ? `${targetWardName} (via Head Office)`
// //           : (a.ward || a.userWard);
// //         page.drawText(`Ward: ${wardDisp}`, { x, y: y - 35, size: 10, font: bodyFont });
// //         page.drawText(`Month: ${a.seleMonth} Date: ${new Date(a.date).toLocaleDateString()}`, {
// //           x, y: y - 50, size: 10, font: bodyFont
// //         });

// //         if (a.signature.startsWith('data:image')) {
// //           const imgBytes = Buffer.from(a.signature.split(',')[1], 'base64');
// //           const img      = a.signature.includes('png')
// //             ? await pdfDoc.embedPng(imgBytes)
// //             : await pdfDoc.embedJpg(imgBytes);
// //           page.drawImage(img, { x, y: y - 100, width: 80, height: 30 });
// //         } else {
// //           page.drawText('✓ Signature Applied', { x, y: y - 80, size: 10, font: bodyFont });
// //         }
// //       }

// //       const outBytes    = await pdfDoc.save();
// //       const updatedPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
// //       fs.writeFileSync(updatedPath, outBytes);
// //       return updatedPath;
// //     };

//     // // 4. Build approval-data array
//     // const createApprovalData = (remarks, targetWard, month, wName) => {
//     //   const hierarchy = ['Lipik','Junior Engineer','Accountant','Assistant Municipal Commissioner','Dy.Municipal Commissioner'];
//     //   return remarks
//     //     .filter(r => (r.role === "Junior Engineer" && r.userWard === "Head Office")
//     //               || r.ward === targetWard
//     //               || r.userWard === targetWard)
//     //     .map(r => ({
//     //       role:      r.role,
//     //       remark:    r.remark,
//     //       signature: r.signature,
//     //       date:      r.date,
//     //       status:    r.remark === 'Approved' ? 'verified' : 'pending',
//     //       ward:      r.ward,
//     //       userWard:  r.userWard,
//     //       seleMonth: month,
//     //       wardName:  wName || targetWard
//     //     }))
//     //     .sort((a, b) => hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role));
//     // };


//     // --------------------------------------
//     // ✅ Combined logic from both versions
// // - Preserves all original pages
// // - Adds a single new page at the end for "APPROVAL SIGNATURES"
// // - Renders all role-wise signatures in grid layout

// // const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
// //   const existingPdfBytes = fs.readFileSync(pdfPath);
// //   const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);

// //   const pages = pdfDoc.getPages();
// //   const { width, height } = pages[0].getSize();

// //   // ✅ DO NOT remove any page
// //   // const pageCount = pdfDoc.getPageCount();
// //   // if (pageCount > 1) pdfDoc.removePage(pageCount - 1); ❌

// //   // ✅ Create a NEW page for signatures
// //   const signaturePage = pdfDoc.addPage([width, height]);
// //   const titleFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
// //   const bodyFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

// //   signaturePage.drawText('APPROVAL SIGNATURES', {
// //     x: 50,
// //     y: height - 50,
// //     size: 18,
// //     font: titleFont,
// //   });

// //   const columns = 2;
// //   const rows = 3;
// //   const cellWidth = (width - 100) / columns;
// //   const cellHeight = 140;
// //   const startX = 50;
// //   const startY = height - 100;

// //   const order = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
// //   const sortedData = approvalData
// //     .filter(a => a.signature)
// //     .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

// //   for (let i = 0; i < sortedData.length; i++) {
// //     const a = sortedData[i];
// //     const col = i % columns;
// //     const row = Math.floor(i / columns);

// //     const x = startX + col * cellWidth;
// //     const y = startY - row * cellHeight;

// //     signaturePage.drawRectangle({
// //       x: x - 5,
// //       y: y - cellHeight + 10,
// //       width: cellWidth,
// //       height: cellHeight - 20,
// //       color: PDFLib.rgb(0.97, 0.97, 0.97),
// //     });

// //     signaturePage.drawText(`${a.role}:`, { x, y, size: 12, font: titleFont });
// //     signaturePage.drawText(`Status: ${a.status}`, { x, y: y - 20, size: 10, font: bodyFont });

// //     const wardDisplay = (a.role === 'Junior Engineer' && a.userWard === 'Head Office')
// //       ? `${targetWardName} (via Head Office)`
// //       : (a.ward || a.userWard);

// //     signaturePage.drawText(`Ward: ${wardDisplay}`, { x, y: y - 35, size: 10, font: bodyFont });
// //     signaturePage.drawText(`Month: ${a.seleMonth} Date: ${new Date(a.date).toLocaleDateString()}`, {
// //       x,
// //       y: y - 50,
// //       size: 10,
// //       font: bodyFont,
// //     });

// //     if (a.signature.startsWith('data:image')) {
// //       const imgBytes = Buffer.from(a.signature.split(',')[1], 'base64');
// //       const img = a.signature.includes('png') ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);
// //       signaturePage.drawImage(img, {
// //         x,
// //         y: y - 100,
// //         width: 80,
// //         height: 30,
// //       });
// //     } else {
// //       signaturePage.drawText('✓ Signature Applied', {
// //         x,
// //         y: y - 80,
// //         size: 10,
// //         font: bodyFont,
// //       });
// //     }
// //   }

// //   const outBytes = await pdfDoc.save();
// //   const updatedPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
// //   fs.writeFileSync(updatedPath, outBytes);
// //   return updatedPath;
// // };
// // --------------------------------
// const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
//   const existingPdfBytes = fs.readFileSync(pdfPath);
//   const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//   const pages = pdfDoc.getPages();
//   const { width, height } = pages[0].getSize();

//   // Remove old Approval Signatures page if exists (last page and has "APPROVAL SIGNATURES")
//   const lastPage = pages[pages.length - 1];
//   const lastPageText = await pdfDoc.getTextContent ? await pdfDoc.getTextContent(lastPage) : null;
//   if (pages.length > 1) {
//     pdfDoc.removePage(pages.length - 1);
//   }

//   // Create a new single Approval Signatures page
//   const page = pdfDoc.addPage([width, height]);
//   const titleFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
//   const bodyFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

//   page.drawText('APPROVAL SIGNATURES', { x: 50, y: height - 50, size: 18, font: titleFont });

//   const columns = 2;
//   const cellWidth = (width - 100) / columns;
//   const cellHeight = 140;
//   const startX = 50;
//   const startY = height - 100;

//   const order = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//   const sortedData = approvalData
//     .filter(a => a.signature)
//     .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

//   for (let i = 0; i < sortedData.length; i++) {
//     const a = sortedData[i];
//     const col = i % columns;
//     const row = Math.floor(i / columns);

//     const x = startX + col * cellWidth;
//     const y = startY - row * cellHeight;

//     page.drawRectangle({
//       x: x - 5,
//       y: y - cellHeight + 10,
//       width: cellWidth,
//       height: cellHeight - 20,
//       color: PDFLib.rgb(0.97, 0.97, 0.97)
//     });

//     page.drawText(`${a.role}:`, { x, y, size: 12, font: titleFont });
//     page.drawText(`Status: ${a.status}`, { x, y: y - 20, size: 10, font: bodyFont });

//     const wardDisplay = (a.role === 'Junior Engineer' && a.userWard === 'Head Office') ? `${targetWardName} (via Head Office)` : (a.ward || a.userWard);
//     page.drawText(`Ward: ${wardDisplay}`, { x, y: y - 35, size: 10, font: bodyFont });

//     page.drawText(`Month: ${a.seleMonth} Date: ${new Date(a.date).toLocaleDateString()}`, { x, y: y - 50, size: 10, font: bodyFont });

//     if (a.signature.startsWith('data:image')) {
//       const imgBytes = Buffer.from(a.signature.split(',')[1], 'base64');
//       const img = a.signature.includes('png') ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);
//       page.drawImage(img, { x, y: y - 100, width: 80, height: 30 });
//     } else {
//       page.drawText('✓ Signature Applied', { x, y: y - 80, size: 10, font: bodyFont });
//     }
//   }

//   const outBytes = await pdfDoc.save();
//   const updatedPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//   fs.writeFileSync(updatedPath, outBytes);
//   return updatedPath;
// };

// // ----------------------------
// // const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
// //   const existingPdfBytes = fs.readFileSync(pdfPath);
// //   const pdfDoc = await PDFDocument.load(existingPdfBytes);
// //   const pages = pdfDoc.getPages();

// //   const signaturePage = pdfDoc.addPage();
// //   const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
// //   const fontSize = 12;

// //   signaturePage.drawText("Approval Signatures", {
// //     x: 50,
// //     y: signaturePage.getHeight() - 50,
// //     size: 16,
// //     font,
// //     color: rgb(0, 0, 0),
// //   });

// //   let y = signaturePage.getHeight() - 80;

// //   const filteredApprovals = approvalData.filter(
// //     (a) => a.formType === formNum && a.ward === targetWardName
// //   );

// //   filteredApprovals.forEach((approval, i) => {
// //     signaturePage.drawText(`${i + 1}. ${approval.role}`, {
// //       x: 50,
// //       y,
// //       size: fontSize,
// //       font,
// //       color: rgb(0, 0, 0),
// //     });

// //     if (approval.signature) {
// //       const sigBytes = Buffer.from(approval.signature.split(",")[1], "base64");
// //       pdfDoc.embedPng(sigBytes).then((sigImage) => {
// //         signaturePage.drawImage(sigImage, {
// //           x: 200,
// //           y: y - 10,
// //           width: 100,
// //           height: 40,
// //         });
// //       });
// //     }

// //     y -= 60;
// //   });

// //   return await pdfDoc.save();
// // };


//     const createApprovalData = (remarks, targetWard, month, wName) => {
//       const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//       return remarks
//         .filter(r => (r.role === "Junior Engineer" && r.userWard === "Head Office") || r.ward === targetWard || r.userWard === targetWard)
//         .map(r => ({
//           role: r.role,
//           remark: r.remark,
//           signature: r.signature,
//           date: r.date,
//           status: r.remark === 'Approved' ? 'verified' : 'pending',
//           ward: r.ward,
//           userWard: r.userWard,
//           seleMonth: month,
//           wardName: wName || targetWard
//         }))
//         .sort((a, b) => hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role));
//     };

//     let report;

//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r =>
//         r.userId.toString() === userId &&
//         r.role === "Junior Engineer" &&
//         (r.ward === "Head Office" || r.userWard === "Head Office")
//       );

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
//               doc.pdfFile = await updatePdfWithAllSignatures(
//                 doc.pdfFile,
//                 createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth, wardName),
//                 doc.formNumber,
//                 wardName
//               );
//               doc.lastUpdated = new Date();
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) {
//       report = new Report({
//         seleMonth,
//         ward,
//         monthReport: seleMonth,
//         reportingRemarks: []
//       });
//     }

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(
//             report,
//             checkRole,
//             checkRole === "Junior Engineer"
//               ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w))
//               : ward,
//             userId
//           );
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r =>
//       r.userId.toString() === userId &&
//       r.role === role &&
//       (r.ward === ward || r.userWard === ward)
//     );

//     if (index !== -1) {
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);
//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);

//           if (remark === "Approved") {
//             doc.pdfFile = await updatePdfWithAllSignatures(
//               doc.pdfFile,
//               createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//               doc.formNumber,
//               wardName
//             );
//             doc.lastUpdated = new Date();
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);

//           if (remark === "Approved") {
//             newDoc.pdfFile = await updatePdfWithAllSignatures(
//               newDoc.pdfFile,
//               createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//               newDoc.formNumber,
//               wardName
//             );
//             newDoc.lastUpdated = new Date();
//           }
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//               doc.pdfFile = await updatePdfWithAllSignatures(
//                 doc.pdfFile,
//                 createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//                 doc.formNumber,
//                 wardName
//               );
//               doc.lastUpdated = new Date();
//             }
//           }
//         }
//       }
//       report.reportingRemarks[index] = existing;
//     } else {
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
//         document.pdfFile = await updatePdfWithAllSignatures(
//           document.pdfFile,
//           createApprovalData([remarkObj], ward, seleMonth, wardName),
//           document.formNumber,
//           wardName
//         );
//         document.lastUpdated = new Date();
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) {
//           return res.status(400).json({ message: "Lipik remark not found." });
//         }

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);
//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           doc.signatures = doc.signatures || {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) {
//             doc.approvedBy.push(userId);
//           }
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
//           if (remark === "Approved") {
//             doc.pdfFile = await updatePdfWithAllSignatures(
//               doc.pdfFile,
//               createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
//               doc.formNumber,
//               wardName
//             );
//             doc.lastUpdated = new Date();
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
//           if (remark === "Approved") {
//             newDoc.pdfFile = await updatePdfWithAllSignatures(
//               newDoc.pdfFile,
//               createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
//               newDoc.formNumber,
//               wardName
//             );
//             newDoc.lastUpdated = new Date();
//           }
//           lipik.documents.push(newDoc);
//         }
//       }
//       report.reportingRemarks.push(remarkObj);
//     }

//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => {
//       doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//     });

//     await report.save();
//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };
// -------------------------------------
// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;

//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");
//     if (missingFields.length) {
//       return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });
//     }

//     const formNumber = await generateFormNumber(formType);
//     let document = null;
//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) {
//         return res.status(400).json({ message: "Invalid base64 PDF." });
//       }
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // ✅ FIXED: Updated PDF signature function - preserves all original pages
//     const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
//       try {
//         const existingPdfBytes = fs.readFileSync(pdfPath);
//         const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//         const pages = pdfDoc.getPages();
//         const { width, height } = pages[0].getSize();

//         // ✅ Check if last page is likely an approval signatures page
//         // We'll only remove the last page if there are more than 2 pages (original + signature)
//         // and the document seems to have been processed before
//         let shouldRemoveLastPage = false;
//         if (pages.length > 2) {
//           // If we have more than 2 pages, likely the last one is a signature page from previous processing
//           shouldRemoveLastPage = true;
//         } else if (pages.length === 2) {
//           // For 2 pages, we need to be more careful
//           // Only remove if we're updating an existing document (indicated by having approval data)
//           const hasExistingApprovals = approvalData && approvalData.length > 0;
//           shouldRemoveLastPage = hasExistingApprovals;
//         }

//         if (shouldRemoveLastPage) {
//           pdfDoc.removePage(pages.length - 1);
//         }

//         // ✅ Create a NEW signature page
//         const signaturePage = pdfDoc.addPage([width, height]);
//         const titleFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
//         const bodyFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

//         // Title
//         signaturePage.drawText('APPROVAL SIGNATURES', {
//           x: 50,
//           y: height - 50,
//           size: 18,
//           font: titleFont,
//         });

//         // Grid layout for signatures
//         const columns = 2;
//         const cellWidth = (width - 100) / columns;
//         const cellHeight = 140;
//         const startX = 50;
//         const startY = height - 100;

//         const order = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//         const sortedData = approvalData
//           .filter(a => a.signature)
//           .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

//         for (let i = 0; i < sortedData.length; i++) {
//           const a = sortedData[i];
//           const col = i % columns;
//           const row = Math.floor(i / columns);

//           const x = startX + col * cellWidth;
//           const y = startY - row * cellHeight;

//           // Background rectangle
//           signaturePage.drawRectangle({
//             x: x - 5,
//             y: y - cellHeight + 10,
//             width: cellWidth,
//             height: cellHeight - 20,
//             color: PDFLib.rgb(0.97, 0.97, 0.97),
//           });

//           // Role text
//           signaturePage.drawText(`${a.role}:`, { x, y, size: 12, font: titleFont });
          
//           // Status text
//           signaturePage.drawText(`Status: ${a.status}`, { 
//             x, y: y - 20, size: 10, font: bodyFont 
//           });

//           // Ward display logic
//           const wardDisplay = (a.role === 'Junior Engineer' && a.userWard === 'Head Office')
//             ? `${targetWardName} (via Head Office)`
//             : (a.ward || a.userWard);

//           signaturePage.drawText(`Ward: ${wardDisplay}`, { 
//             x, y: y - 35, size: 10, font: bodyFont 
//           });

//           // Date and month
//           signaturePage.drawText(`Month: ${a.seleMonth} Date: ${new Date(a.date).toLocaleDateString()}`, {
//             x, y: y - 50, size: 10, font: bodyFont,
//           });

//           // Signature image or text
//           if (a.signature && a.signature.startsWith('data:image')) {
//             try {
//               const imgBytes = Buffer.from(a.signature.split(',')[1], 'base64');
//               const img = a.signature.includes('png') 
//                 ? await pdfDoc.embedPng(imgBytes) 
//                 : await pdfDoc.embedJpg(imgBytes);
              
//               signaturePage.drawImage(img, {
//                 x, y: y - 100, width: 80, height: 30,
//               });
//             } catch (imgError) {
//               console.warn('Failed to embed signature image:', imgError);
//               signaturePage.drawText('✓ Signature Applied', {
//                 x, y: y - 80, size: 10, font: bodyFont,
//               });
//             }
//           } else {
//             signaturePage.drawText('✓ Signature Applied', {
//               x, y: y - 80, size: 10, font: bodyFont,
//             });
//           }
//         }

//         // Save the updated PDF
//         const outBytes = await pdfDoc.save();
//         const updatedPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//         fs.writeFileSync(updatedPath, outBytes);
//         return updatedPath;

//       } catch (error) {
//         console.error('Error updating PDF with signatures:', error);
//         throw error;
//       }
//     };

//     const createApprovalData = (remarks, targetWard, month, wName) => {
//       const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//       return remarks
//         .filter(r => (r.role === "Junior Engineer" && r.userWard === "Head Office") || r.ward === targetWard || r.userWard === targetWard)
//         .map(r => ({
//           role: r.role,
//           remark: r.remark,
//           signature: r.signature,
//           date: r.date,
//           status: r.remark === 'Approved' ? 'verified' : 'pending',
//           ward: r.ward,
//           userWard: r.userWard,
//           seleMonth: month,
//           wardName: wName || targetWard
//         }))
//         .sort((a, b) => hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role));
//     };

//     let report;

//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r =>
//         r.userId.toString() === userId &&
//         r.role === "Junior Engineer" &&
//         (r.ward === "Head Office" || r.userWard === "Head Office")
//       );

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
//               doc.pdfFile = await updatePdfWithAllSignatures(
//                 doc.pdfFile,
//                 createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth, wardName),
//                 doc.formNumber,
//                 wardName
//               );
//               doc.lastUpdated = new Date();
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) {
//       report = new Report({
//         seleMonth,
//         ward,
//         monthReport: seleMonth,
//         reportingRemarks: []
//       });
//     }

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(
//             report,
//             checkRole,
//             checkRole === "Junior Engineer"
//               ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w))
//               : ward,
//             userId
//           );
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r =>
//       r.userId.toString() === userId &&
//       r.role === role &&
//       (r.ward === ward || r.userWard === ward)
//     );

//     if (index !== -1) {
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);
//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);

//           if (remark === "Approved") {
//             doc.pdfFile = await updatePdfWithAllSignatures(
//               doc.pdfFile,
//               createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//               doc.formNumber,
//               wardName
//             );
//             doc.lastUpdated = new Date();
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);

//           if (remark === "Approved") {
//             newDoc.pdfFile = await updatePdfWithAllSignatures(
//               newDoc.pdfFile,
//               createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//               newDoc.formNumber,
//               wardName
//             );
//             newDoc.lastUpdated = new Date();
//           }
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//               doc.pdfFile = await updatePdfWithAllSignatures(
//                 doc.pdfFile,
//                 createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//                 doc.formNumber,
//                 wardName
//               );
//               doc.lastUpdated = new Date();
//             }
//           }
//         }
//       }
//       report.reportingRemarks[index] = existing;
//     } else {
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
//         document.pdfFile = await updatePdfWithAllSignatures(
//           document.pdfFile,
//           createApprovalData([remarkObj], ward, seleMonth, wardName),
//           document.formNumber,
//           wardName
//         );
//         document.lastUpdated = new Date();
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) {
//           return res.status(400).json({ message: "Lipik remark not found." });
//         }

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);
//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           doc.signatures = doc.signatures || {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) {
//             doc.approvedBy.push(userId);
//           }
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
//           if (remark === "Approved") {
//             doc.pdfFile = await updatePdfWithAllSignatures(
//               doc.pdfFile,
//               createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
//               doc.formNumber,
//               wardName
//             );
//             doc.lastUpdated = new Date();
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
//           if (remark === "Approved") {
//             newDoc.pdfFile = await updatePdfWithAllSignatures(
//               newDoc.pdfFile,
//               createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
//               newDoc.formNumber,
//               wardName
//             );
//             newDoc.lastUpdated = new Date();
//           }
//           lipik.documents.push(newDoc);
//         }
//       }
//       report.reportingRemarks.push(remarkObj);
//     }

//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => {
//       doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//     });

//     await report.save();
//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };
// ------------------------------------------------
// ya madhe all correct fakt ekach Approval signature extra banalay
// exports.addRemarkReports = async (req, res) => {
//   try {
//     const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
//     const userWard = ward;

//     const missingFields = [];
//     if (!role) missingFields.push("role");
//     if (!remark) missingFields.push("remark");
//     if (!formType) missingFields.push("formType");
//     if (!seleMonth) missingFields.push("seleMonth");
//     if (!ward) missingFields.push("ward");
//     if (missingFields.length) {
//       return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });
//     }

//     const formNumber = await generateFormNumber(formType);
//     let document = null;
//     if (req.file) {
//       document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else if (pdfData) {
//       const pdfFilePath = saveBase64File(pdfData, formNumber);
//       if (!pdfFilePath) {
//         return res.status(400).json({ message: "Invalid base64 PDF." });
//       }
//       document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
//     } else {
//       return res.status(400).json({ message: "PDF file or base64 required." });
//     }

//     // ✅ FIXED: Enhanced PDF signature function - preserves ALL original pages
//     const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
//       try {
//         const existingPdfBytes = fs.readFileSync(pdfPath);
//         const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
//         const pages = pdfDoc.getPages();
//         const { width, height } = pages[0].getSize();

//         // ✅ CRITICAL FIX: Only remove signature pages, never original content pages
//         // We'll identify signature pages by checking if they contain "APPROVAL SIGNATURES" text
//         let signaturePageIndex = -1;
        
//         // Check each page for signature content starting from the end
//         for (let i = pages.length - 1; i >= 0; i--) {
//           try {
//             // If this is clearly a signature page (last page and document has been processed before)
//             // We use a more conservative approach - only remove if we have clear indicators
//             if (i === pages.length - 1 && pages.length > 2) {
//               // Only remove the last page if:
//               // 1. We have more than 2 pages
//               // 2. AND we have existing approval data (indicating previous processing)
//               // 3. AND this appears to be an update operation
//               const hasExistingApprovals = approvalData && approvalData.length > 0;
//               const isUpdateOperation = approvalData && approvalData.some(a => a.signature);
              
//               if (hasExistingApprovals && isUpdateOperation) {
//                 signaturePageIndex = i;
//                 break;
//               }
//             }
//           } catch (pageError) {
//             console.warn(`Could not analyze page ${i}:`, pageError);
//           }
//         }

//         // Remove signature page only if we found one
//         if (signaturePageIndex >= 0) {
//           console.log(`Removing signature page at index: ${signaturePageIndex}`);
//           pdfDoc.removePage(signaturePageIndex);
//         }

//         // ✅ Always create a fresh signature page (this ensures consistency)
//         const signaturePage = pdfDoc.addPage([width, height]);
//         const titleFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
//         const bodyFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

//         // Title
//         signaturePage.drawText('APPROVAL SIGNATURES', {
//           x: 50,
//           y: height - 50,
//           size: 18,
//           font: titleFont,
//           color: PDFLib.rgb(0, 0, 0)
//         });

//         // Add a subtitle with form info
//         signaturePage.drawText(`Form: ${formNum} | Month: ${targetWardName ? `${seleMonth} (Ward: ${targetWardName})` : seleMonth}`, {
//           x: 50,
//           y: height - 75,
//           size: 10,
//           font: bodyFont,
//           color: PDFLib.rgb(0.3, 0.3, 0.3)
//         });

//         // Grid layout for signatures
//         const columns = 2;
//         const cellWidth = (width - 100) / columns;
//         const cellHeight = 140;
//         const startX = 50;
//         const startY = height - 110; // Adjusted to accommodate subtitle

//         const order = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//         const sortedData = approvalData
//           .filter(a => a.signature)
//           .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

//         for (let i = 0; i < sortedData.length; i++) {
//           const a = sortedData[i];
//           const col = i % columns;
//           const row = Math.floor(i / columns);

//           const x = startX + col * cellWidth;
//           const y = startY - row * cellHeight;

//           // Background rectangle with border
//           signaturePage.drawRectangle({
//             x: x - 5,
//             y: y - cellHeight + 10,
//             width: cellWidth - 10,
//             height: cellHeight - 20,
//             color: PDFLib.rgb(0.98, 0.98, 0.98),
//             borderColor: PDFLib.rgb(0.8, 0.8, 0.8),
//             borderWidth: 1,
//           });

//           // Role text
//           signaturePage.drawText(`${a.role}:`, { 
//             x: x + 5, 
//             y: y - 5, 
//             size: 12, 
//             font: titleFont,
//             color: PDFLib.rgb(0.2, 0.2, 0.2)
//           });
          
//           // Status text with color coding
//           const statusColor = a.status === 'verified' ? PDFLib.rgb(0, 0.6, 0) : PDFLib.rgb(0.8, 0.4, 0);
//           signaturePage.drawText(`Status: ${a.status}`, { 
//             x: x + 5, 
//             y: y - 25, 
//             size: 10, 
//             font: bodyFont,
//             color: statusColor
//           });

//           // Ward display logic
//           const wardDisplay = (a.role === 'Junior Engineer' && a.userWard === 'Head Office')
//             ? `${targetWardName} (via Head Office)`
//             : (a.ward || a.userWard);

//           signaturePage.drawText(`Ward: ${wardDisplay}`, { 
//             x: x + 5, 
//             y: y - 40, 
//             size: 10, 
//             font: bodyFont,
//             color: PDFLib.rgb(0.4, 0.4, 0.4)
//           });

//           // Date and month
//           signaturePage.drawText(`Month: ${a.seleMonth}`, {
//             x: x + 5, 
//             y: y - 55, 
//             size: 10, 
//             font: bodyFont,
//             color: PDFLib.rgb(0.4, 0.4, 0.4)
//           });

//           signaturePage.drawText(`Date: ${new Date(a.date).toLocaleDateString()}`, {
//             x: x + 5, 
//             y: y - 70, 
//             size: 10, 
//             font: bodyFont,
//             color: PDFLib.rgb(0.4, 0.4, 0.4)
//           });

//           // Signature image or text
//           if (a.signature && a.signature.startsWith('data:image')) {
//             try {
//               const imgBytes = Buffer.from(a.signature.split(',')[1], 'base64');
//               const img = a.signature.includes('png') 
//                 ? await pdfDoc.embedPng(imgBytes) 
//                 : await pdfDoc.embedJpg(imgBytes);
              
//               signaturePage.drawImage(img, {
//                 x: x + 5, 
//                 y: y - 110, 
//                 width: 100, 
//                 height: 30,
//               });
//             } catch (imgError) {
//               console.warn('Failed to embed signature image:', imgError);
//               signaturePage.drawText('✓ Digital Signature Applied', {
//                 x: x + 5, 
//                 y: y - 95, 
//                 size: 9, 
//                 font: bodyFont,
//                 color: PDFLib.rgb(0, 0.5, 0)
//               });
//             }
//           } else {
//             signaturePage.drawText('✓ Digital Signature Applied', {
//               x: x + 5, 
//               y: y - 95, 
//               size: 9, 
//               font: bodyFont,
//               color: PDFLib.rgb(0, 0.5, 0)
//             });
//           }
//         }

//         // Add footer with timestamp
//         signaturePage.drawText(`Generated: ${new Date().toLocaleString()}`, {
//           x: 50,
//           y: 30,
//           size: 8,
//           font: bodyFont,
//           color: PDFLib.rgb(0.6, 0.6, 0.6)
//         });

//         // Save the updated PDF
//         const outBytes = await pdfDoc.save();
//         const updatedPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
//         fs.writeFileSync(updatedPath, outBytes);
        
//         console.log(`PDF updated successfully. Original pages: ${pages.length}, Final pages: ${pdfDoc.getPageCount()}`);
//         return updatedPath;

//       } catch (error) {
//         console.error('Error updating PDF with signatures:', error);
//         throw error;
//       }
//     };

//     const createApprovalData = (remarks, targetWard, month, wName) => {
//       const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
//       return remarks
//         .filter(r => (r.role === "Junior Engineer" && r.userWard === "Head Office") || r.ward === targetWard || r.userWard === targetWard)
//         .map(r => ({
//           role: r.role,
//           remark: r.remark,
//           signature: r.signature,
//           date: r.date,
//           status: r.remark === 'Approved' ? 'verified' : 'pending',
//           ward: r.ward,
//           userWard: r.userWard,
//           seleMonth: month,
//           wardName: wName || targetWard
//         }))
//         .sort((a, b) => hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role));
//     };

//     let report;

//     if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
//       report = await Report.findOne({ seleMonth, ward: wardName });
//       if (!report) return res.status(400).json({ message: "Ward report not found." });

//       const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
//       if (!approved) {
//         const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
//         return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
//       }

//       const jeRemark = {
//         userId: new mongoose.Types.ObjectId(userId),
//         role: "Junior Engineer",
//         ward: "Head Office",
//         userWard: "Head Office",
//         remark,
//         signature,
//         date: new Date()
//       };

//       const exists = report.reportingRemarks.some(r =>
//         r.userId.toString() === userId &&
//         r.role === "Junior Engineer" &&
//         (r.ward === "Head Office" || r.userWard === "Head Office")
//       );

//       if (!exists) {
//         if (remark === "Approved") {
//           const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//           if (lipik?.documents) {
//             for (let doc of lipik.documents) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
//               doc.pdfFile = await updatePdfWithAllSignatures(
//                 doc.pdfFile,
//                 createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth, wardName),
//                 doc.formNumber,
//                 wardName
//               );
//               doc.lastUpdated = new Date();
//             }
//           }
//         }
//         report.reportingRemarks.push(jeRemark);
//         await report.save();
//       }
//       return res.status(201).json({ message: "Head Office JE remark added.", report });
//     }

//     report = await Report.findOne({ seleMonth, ward });
//     if (!report) {
//       report = new Report({
//         seleMonth,
//         ward,
//         monthReport: seleMonth,
//         reportingRemarks: []
//       });
//     }

//     if (report.reportingRemarks.length === 0 && role !== "Lipik") {
//       return res.status(400).json({ message: "First remark must be from Lipik." });
//     }

//     if (role !== "Lipik") {
//       const checks = {
//         "Junior Engineer": "Lipik",
//         "Accountant": "Junior Engineer",
//         "Assistant Municipal Commissioner": "Accountant",
//         "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
//       };
//       const checkRole = checks[role];
//       if (checkRole) {
//         const approved = checkRole === "Junior Engineer" && role === "Accountant"
//           ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
//           : areAllFormsApprovedByRole(report, checkRole, ward);

//         if (!approved) {
//           const missing = getMissingFormTypes(
//             report,
//             checkRole,
//             checkRole === "Junior Engineer"
//               ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w))
//               : ward,
//             userId
//           );
//           return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
//         }
//       }
//     }

//     const index = report.reportingRemarks.findIndex(r =>
//       r.userId.toString() === userId &&
//       r.role === role &&
//       (r.ward === ward || r.userWard === ward)
//     );

//     if (index !== -1) {
//       const existing = report.reportingRemarks[index];
//       existing.remark = remark;
//       existing.signature = signature;
//       existing.date = new Date();

//       if (role === "Lipik") {
//         const docs = existing.documents || [];
//         const docIndex = docs.findIndex(d => d.formType === formType);
//         if (docIndex !== -1) {
//           const doc = docs[docIndex];
//           doc.uploadedAt = new Date();
//           doc.pdfFile = document.pdfFile;
//           doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
//           doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);

//           if (remark === "Approved") {
//             doc.pdfFile = await updatePdfWithAllSignatures(
//               doc.pdfFile,
//               createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//               doc.formNumber,
//               wardName
//             );
//             doc.lastUpdated = new Date();
//           }
//         } else {
//           const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);

//           if (remark === "Approved") {
//             newDoc.pdfFile = await updatePdfWithAllSignatures(
//               newDoc.pdfFile,
//               createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//               newDoc.formNumber,
//               wardName
//             );
//             newDoc.lastUpdated = new Date();
//           }
//           docs.push(newDoc);
//         }
//         existing.documents = docs;
//       }

//       if (remark === "Approved") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (lipik?.documents) {
//           for (let doc of lipik.documents) {
//             if (role === "Lipik" || doc.formType === formType) {
//               if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
//               doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//               doc.pdfFile = await updatePdfWithAllSignatures(
//                 doc.pdfFile,
//                 createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
//                 doc.formNumber,
//                 wardName
//               );
//               doc.lastUpdated = new Date();
//             }
//           }
//         }
//       }
//       report.reportingRemarks[index] = existing;
//     } else {
//       const remarkObj = {
//         userId: new mongoose.Types.ObjectId(userId),
//         ward,
//         role,
//         remark,
//         signature,
//         userWard,
//         date: new Date(),
//         documents: []
//       };

//       if (role === "Lipik" && remark === "Approved") {
//         document.approvedBy.push(userId);
//         document.doneBy = populateDoneByArray(document, [remarkObj], ward);
//         document.pdfFile = await updatePdfWithAllSignatures(
//           document.pdfFile,
//           createApprovalData([remarkObj], ward, seleMonth, wardName),
//           document.formNumber,
//           wardName
//         );
//         document.lastUpdated = new Date();
//         remarkObj.documents.push(document);
//       } else if (role !== "Lipik") {
//         const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//         if (!lipik) {
//           return res.status(400).json({ message: "Lipik remark not found." });
//         }

//         const docIndex = lipik.documents.findIndex(d => d.formType === formType);
//         if (docIndex !== -1) {
//           const doc = lipik.documents[docIndex];
//           doc.signatures = doc.signatures || {};
//           doc.signatures[role] = signature;
//           if (remark === "Approved" && !doc.approvedBy.includes(userId)) {
//             doc.approvedBy.push(userId);
//           }
//           doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
//           if (remark === "Approved") {
//             doc.pdfFile = await updatePdfWithAllSignatures(
//               doc.pdfFile,
//               createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
//               doc.formNumber,
//               wardName
//             );
//             doc.lastUpdated = new Date();
//           }
//         } else {
//           const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
//           newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
//           if (remark === "Approved") {
//             newDoc.pdfFile = await updatePdfWithAllSignatures(
//               newDoc.pdfFile,
//               createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
//               newDoc.formNumber,
//               wardName
//             );
//             newDoc.lastUpdated = new Date();
//           }
//           lipik.documents.push(newDoc);
//         }
//       }
//       report.reportingRemarks.push(remarkObj);
//     }

//     const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
//     lipik?.documents?.forEach(doc => {
//       doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
//     });

//     await report.save();
//     res.status(201).json({ message: "Report saved.", report });
//   } catch (error) {
//     console.error("🚨 Error:", error);
//     res.status(500).json({ message: "Error while saving report.", error: error.message });
//   }
// };

// --------------------------------------------

exports.addRemarkReports = async (req, res) => {
  try {
    const { userId, remark, role, signature, ward, formType, pdfData, seleMonth, wardName, mode } = req.body;
    const userWard = ward;

    const missingFields = [];
    if (!role) missingFields.push("role");
    if (!remark) missingFields.push("remark");
    if (!formType) missingFields.push("formType");
    if (!seleMonth) missingFields.push("seleMonth");
    if (!ward) missingFields.push("ward");
    if (missingFields.length) {
      return res.status(400).json({ message: `Missing: ${missingFields.join(", ")}` });
    }

    const formNumber = await generateFormNumber(formType);
    let document = null;
    if (req.file) {
      document = { formType, formNumber, pdfFile: req.file.path, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
    } else if (pdfData) {
      const pdfFilePath = saveBase64File(pdfData, formNumber);
      if (!pdfFilePath) {
        return res.status(400).json({ message: "Invalid base64 PDF." });
      }
      document = { formType, formNumber, pdfFile: pdfFilePath, uploadedAt: new Date(), seleMonth, approvedBy: [], doneBy: [] };
    } else {
      return res.status(400).json({ message: "PDF file or base64 required." });
    }

    // ✅ FIXED: Enhanced PDF signature function - removes ALL signature pages and creates one complete page
    const updatePdfWithAllSignatures = async (pdfPath, approvalData, formNum, targetWardName) => {
      try {
        const existingPdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
        const pages = pdfDoc.getPages();
        const { width, height } = pages[0].getSize();

        console.log(`Processing PDF: ${formNum}, Original pages: ${pages.length}`);

        // ✅ CRITICAL FIX: Remove ALL signature pages (not just the last one)
        // We'll scan from the end and remove any page that might be a signature page
        let removedPages = 0;
        for (let i = pages.length - 1; i >= 0; i--) {
          // Only remove pages beyond the first 2 pages (original content)
          // This ensures we never remove original document content
          if (i >= 2) {
            try {
              // Remove any page that's likely a signature page
              // (any page after the first 2 pages is considered a signature page)
              pdfDoc.removePage(i);
              removedPages++;
              console.log(`Removed signature page at index: ${i}`);
            } catch (removeError) {
              console.warn(`Could not remove page ${i}:`, removeError);
              break; // Stop if we can't remove pages
            }
          } else {
            // For pages 0 and 1, we keep them as they are original content
            break;
          }
        }

        console.log(`Removed ${removedPages} signature pages`);

        // ✅ Always create ONE fresh signature page with ALL approval data
        const signaturePage = pdfDoc.addPage([width, height]);
        const titleFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
        const bodyFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

        // Title
        signaturePage.drawText('APPROVAL SIGNATURES', {
          x: 50,
          y: height - 50,
          size: 18,
          font: titleFont,
          color: PDFLib.rgb(0, 0, 0)
        });

        // Add a subtitle with form info
        signaturePage.drawText(`Form: ${formNum} | Month: ${targetWardName ? `${seleMonth} (Ward: ${targetWardName})` : seleMonth}`, {
          x: 50,
          y: height - 75,
          size: 10,
          font: bodyFont,
          color: PDFLib.rgb(0.3, 0.3, 0.3)
        });

        // Grid layout for signatures
        const columns = 2;
        const cellWidth = (width - 100) / columns;
        const cellHeight = 140;
        const startX = 50;
        const startY = height - 110; // Adjusted to accommodate subtitle

        const order = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
        const sortedData = approvalData
          .filter(a => a.signature)
          .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

        console.log(`Adding ${sortedData.length} signatures to the page`);

        for (let i = 0; i < sortedData.length; i++) {
          const a = sortedData[i];
          const col = i % columns;
          const row = Math.floor(i / columns);

          const x = startX + col * cellWidth;
          const y = startY - row * cellHeight;

          // Background rectangle with border
          signaturePage.drawRectangle({
            x: x - 5,
            y: y - cellHeight + 10,
            width: cellWidth - 10,
            height: cellHeight - 20,
            color: PDFLib.rgb(0.98, 0.98, 0.98),
            borderColor: PDFLib.rgb(0.8, 0.8, 0.8),
            borderWidth: 1,
          });

          // Role text
          signaturePage.drawText(`${a.role}:`, { 
            x: x + 5, 
            y: y - 5, 
            size: 12, 
            font: titleFont,
            color: PDFLib.rgb(0.2, 0.2, 0.2)
          });
          
          // Status text with color coding
          const statusColor = a.status === 'verified' ? PDFLib.rgb(0, 0.6, 0) : PDFLib.rgb(0.8, 0.4, 0);
          signaturePage.drawText(`Status: ${a.status}`, { 
            x: x + 5, 
            y: y - 25, 
            size: 10, 
            font: bodyFont,
            color: statusColor
          });

          // Ward display logic
          const wardDisplay = (a.role === 'Junior Engineer' && a.userWard === 'Head Office')
            ? `${targetWardName} (via Head Office)`
            : (a.ward || a.userWard);

          signaturePage.drawText(`Ward: ${wardDisplay}`, { 
            x: x + 5, 
            y: y - 40, 
            size: 10, 
            font: bodyFont,
            color: PDFLib.rgb(0.4, 0.4, 0.4)
          });

          // Date and month
          signaturePage.drawText(`Month: ${a.seleMonth}`, {
            x: x + 5, 
            y: y - 55, 
            size: 10, 
            font: bodyFont,
            color: PDFLib.rgb(0.4, 0.4, 0.4)
          });

          signaturePage.drawText(`Date: ${new Date(a.date).toLocaleDateString()}`, {
            x: x + 5, 
            y: y - 70, 
            size: 10, 
            font: bodyFont,
            color: PDFLib.rgb(0.4, 0.4, 0.4)
          });

          // Signature image or text
          if (a.signature && a.signature.startsWith('data:image')) {
            try {
              const imgBytes = Buffer.from(a.signature.split(',')[1], 'base64');
              const img = a.signature.includes('png') 
                ? await pdfDoc.embedPng(imgBytes) 
                : await pdfDoc.embedJpg(imgBytes);
              
              signaturePage.drawImage(img, {
                x: x + 5, 
                y: y - 110, 
                width: 100, 
                height: 30,
              });
            } catch (imgError) {
              console.warn('Failed to embed signature image:', imgError);
              signaturePage.drawText('✓ Digital Signature Applied', {
                x: x + 5, 
                y: y - 95, 
                size: 9, 
                font: bodyFont,
                color: PDFLib.rgb(0, 0.5, 0)
              });
            }
          } else {
            signaturePage.drawText('✓ Digital Signature Applied', {
              x: x + 5, 
              y: y - 95, 
              size: 9, 
              font: bodyFont,
              color: PDFLib.rgb(0, 0.5, 0)
            });
          }
        }

        // Add footer with timestamp
        signaturePage.drawText(`Generated: ${new Date().toLocaleString()}`, {
          x: 50,
          y: 30,
          size: 8,
          font: bodyFont,
          color: PDFLib.rgb(0.6, 0.6, 0.6)
        });

        // Save the updated PDF
        const outBytes = await pdfDoc.save();
        const updatedPath = path.join(path.dirname(pdfPath), `updated_${formNum}_${Date.now()}.pdf`);
        fs.writeFileSync(updatedPath, outBytes);
        
        console.log(`PDF updated successfully. Final pages: ${pdfDoc.getPageCount()}`);
        return updatedPath;

      } catch (error) {
        console.error('Error updating PDF with signatures:', error);
        throw error;
      }
    };

    const createApprovalData = (remarks, targetWard, month, wName) => {
      const hierarchy = ['Lipik', 'Junior Engineer', 'Accountant', 'Assistant Municipal Commissioner', 'Dy.Municipal Commissioner'];
      return remarks
        .filter(r => (r.role === "Junior Engineer" && r.userWard === "Head Office") || r.ward === targetWard || r.userWard === targetWard)
        .map(r => ({
          role: r.role,
          remark: r.remark,
          signature: r.signature,
          date: r.date,
          status: r.remark === 'Approved' ? 'verified' : 'pending',
          ward: r.ward,
          userWard: r.userWard,
          seleMonth: month,
          wardName: wName || targetWard
        }))
        .sort((a, b) => hierarchy.indexOf(a.role) - hierarchy.indexOf(b.role));
    };

    let report;

    if (role === "Junior Engineer" && ward === "Head Office" && wardName) {
      report = await Report.findOne({ seleMonth, ward: wardName });
      if (!report) return res.status(400).json({ message: "Ward report not found." });

      const approved = areAllFormsApprovedByRole(report, "Junior Engineer", wardName);
      if (!approved) {
        const missing = getMissingFormTypes(report, "Junior Engineer", wardName, userId);
        return res.status(400).json({ message: `Ward JE must approve all forms. Missing: ${missing.join(", ")}` });
      }

      const jeRemark = {
        userId: new mongoose.Types.ObjectId(userId),
        role: "Junior Engineer",
        ward: "Head Office",
        userWard: "Head Office",
        remark,
        signature,
        date: new Date()
      };

      const exists = report.reportingRemarks.some(r =>
        r.userId.toString() === userId &&
        r.role === "Junior Engineer" &&
        (r.ward === "Head Office" || r.userWard === "Head Office")
      );

      if (!exists) {
        if (remark === "Approved") {
          const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
          if (lipik?.documents) {
            for (let doc of lipik.documents) {
              if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
              doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, jeRemark], wardName);
              doc.pdfFile = await updatePdfWithAllSignatures(
                doc.pdfFile,
                createApprovalData([...report.reportingRemarks, jeRemark], wardName, seleMonth, wardName),
                doc.formNumber,
                wardName
              );
              doc.lastUpdated = new Date();
            }
          }
        }
        report.reportingRemarks.push(jeRemark);
        await report.save();
      }
      return res.status(201).json({ message: "Head Office JE remark added.", report });
    }

    report = await Report.findOne({ seleMonth, ward });
    if (!report) {
      report = new Report({
        seleMonth,
        ward,
        monthReport: seleMonth,
        reportingRemarks: []
      });
    }

    if (report.reportingRemarks.length === 0 && role !== "Lipik") {
      return res.status(400).json({ message: "First remark must be from Lipik." });
    }

    if (role !== "Lipik") {
      const checks = {
        "Junior Engineer": "Lipik",
        "Accountant": "Junior Engineer",
        "Assistant Municipal Commissioner": "Accountant",
        "Dy.Municipal Commissioner": "Assistant Municipal Commissioner"
      };
      const checkRole = checks[role];
      if (checkRole) {
        const approved = checkRole === "Junior Engineer" && role === "Accountant"
          ? areAllFormsApprovedByRole(report, checkRole, ward) && areAllFormsApprovedByRole(report, checkRole, "Head Office")
          : areAllFormsApprovedByRole(report, checkRole, ward);

        if (!approved) {
          const missing = getMissingFormTypes(
            report,
            checkRole,
            checkRole === "Junior Engineer"
              ? [ward, "Head Office"].find(w => !areAllFormsApprovedByRole(report, checkRole, w))
              : ward,
            userId
          );
          return res.status(400).json({ message: `${checkRole} must approve all forms. Missing: ${missing.join(", ")}` });
        }
      }
    }

    const index = report.reportingRemarks.findIndex(r =>
      r.userId.toString() === userId &&
      r.role === role &&
      (r.ward === ward || r.userWard === ward)
    );

    if (index !== -1) {
      const existing = report.reportingRemarks[index];
      existing.remark = remark;
      existing.signature = signature;
      existing.date = new Date();

      if (role === "Lipik") {
        const docs = existing.documents || [];
        const docIndex = docs.findIndex(d => d.formType === formType);
        if (docIndex !== -1) {
          const doc = docs[docIndex];
          doc.uploadedAt = new Date();
          doc.pdfFile = document.pdfFile;
          doc.approvedBy = remark === "Approved" ? [userId] : doc.approvedBy;
          doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);

          if (remark === "Approved") {
            doc.pdfFile = await updatePdfWithAllSignatures(
              doc.pdfFile,
              createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
              doc.formNumber,
              wardName
            );
            doc.lastUpdated = new Date();
          }
        } else {
          const newDoc = { ...document, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
          newDoc.doneBy = populateDoneByArray(newDoc, report.reportingRemarks, ward);

          if (remark === "Approved") {
            newDoc.pdfFile = await updatePdfWithAllSignatures(
              newDoc.pdfFile,
              createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
              newDoc.formNumber,
              wardName
            );
            newDoc.lastUpdated = new Date();
          }
          docs.push(newDoc);
        }
        existing.documents = docs;
      }

      if (remark === "Approved") {
        const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
        if (lipik?.documents) {
          for (let doc of lipik.documents) {
            if (role === "Lipik" || doc.formType === formType) {
              if (!doc.approvedBy.includes(userId)) doc.approvedBy.push(userId);
              doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
              doc.pdfFile = await updatePdfWithAllSignatures(
                doc.pdfFile,
                createApprovalData(report.reportingRemarks, ward, seleMonth, wardName),
                doc.formNumber,
                wardName
              );
              doc.lastUpdated = new Date();
            }
          }
        }
      }
      report.reportingRemarks[index] = existing;
    } else {
      const remarkObj = {
        userId: new mongoose.Types.ObjectId(userId),
        ward,
        role,
        remark,
        signature,
        userWard,
        date: new Date(),
        documents: []
      };

      if (role === "Lipik" && remark === "Approved") {
        document.approvedBy.push(userId);
        document.doneBy = populateDoneByArray(document, [remarkObj], ward);
        document.pdfFile = await updatePdfWithAllSignatures(
          document.pdfFile,
          createApprovalData([remarkObj], ward, seleMonth, wardName),
          document.formNumber,
          wardName
        );
        document.lastUpdated = new Date();
        remarkObj.documents.push(document);
      } else if (role !== "Lipik") {
        const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
        if (!lipik) {
          return res.status(400).json({ message: "Lipik remark not found." });
        }

        const docIndex = lipik.documents.findIndex(d => d.formType === formType);
        if (docIndex !== -1) {
          const doc = lipik.documents[docIndex];
          doc.signatures = doc.signatures || {};
          doc.signatures[role] = signature;
          if (remark === "Approved" && !doc.approvedBy.includes(userId)) {
            doc.approvedBy.push(userId);
          }
          doc.doneBy = populateDoneByArray(doc, [...report.reportingRemarks, remarkObj], ward);
          if (remark === "Approved") {
            doc.pdfFile = await updatePdfWithAllSignatures(
              doc.pdfFile,
              createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
              doc.formNumber,
              wardName
            );
            doc.lastUpdated = new Date();
          }
        } else {
          const newDoc = { ...document, signatures: { [role]: signature }, approvedBy: remark === "Approved" ? [userId] : [], doneBy: [] };
          newDoc.doneBy = populateDoneByArray(newDoc, [...report.reportingRemarks, remarkObj], ward);
          if (remark === "Approved") {
            newDoc.pdfFile = await updatePdfWithAllSignatures(
              newDoc.pdfFile,
              createApprovalData([...report.reportingRemarks, remarkObj], ward, seleMonth, wardName),
              newDoc.formNumber,
              wardName
            );
            newDoc.lastUpdated = new Date();
          }
          lipik.documents.push(newDoc);
        }
      }
      report.reportingRemarks.push(remarkObj);
    }

    const lipik = report.reportingRemarks.find(r => r.role === "Lipik");
    lipik?.documents?.forEach(doc => {
      doc.doneBy = populateDoneByArray(doc, report.reportingRemarks, ward);
    });

    await report.save();
    res.status(201).json({ message: "Report saved.", report });
  } catch (error) {
    console.error("🚨 Error:", error);
    res.status(500).json({ message: "Error while saving report.", error: error.message });
  }
};





exports.searchReport = async (req, res) => {
    
    try {
        const { month } = req.body;
     


        if (!month) {
            return res.status(400).json({
                message: "Missing required field: month"
            });
        }

        const reports = await Report.find({ seleMonth: month });

        res.status(200).json(reports);
    } catch (error) {
        console.error("❌ Error searching reports:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};




// exports.deleteMonthReport = async (req, res) => {
//   const { month } = req.params;

//   try {
//     const deletedReport = await Report.findOneAndDelete({ monthReport: month });

//     if (!deletedReport) {
//       return res.status(404).json({ message: `Report for month ${month} not found.` });
//     }

//     res.status(200).json({ message: `Report for month ${month} deleted successfully.` });
//   } catch (error) {
//     console.error('Error deleting report:', error);
//     res.status(500).json({ message: 'Internal server error.' });
//   }
// };


exports.deleteMonthReport = async (req, res) => {
    const { month } = req.params;
  
    try {
      // Step 1: Find the report for the given month
      const report = await Report.findOne({ monthReport: month });
  
      if (!report) {
        return res.status(404).json({ message: `Report for month ${month} not found.` });
      }
  
      // Step 2: Delete the PDF related to the report (assuming it's stored in the report)
      const pdfFileName = report.pdfFileName; // assuming the PDF path is stored in `pdfFileName`
      if (pdfFileName) {
        const pdfFilePath = path.join(uploadsDir, pdfFileName);
        if (fs.existsSync(pdfFilePath)) {
          fs.unlinkSync(pdfFilePath); // Delete the PDF file
          console.log(`Deleted PDF file: ${pdfFileName}`);
        }
      }
  
      // Step 3: Delete related signature files in the 'uploads' folder
      const usedFiles = new Set();
  
      // Collect all used signature files from the reportingRemarks.documents array
      report.reportingRemarks.forEach(remark => {
        if (remark.documents && Array.isArray(remark.documents)) {
          remark.documents.forEach(doc => {
            const sig = doc.signature;
            if (sig && !sig.startsWith('data:image')) {
              usedFiles.add(sig); // Add file path to set for comparison
            }
          });
        }
      });
  
      // Step 4: Delete any other signature files that are no longer used
      const filesInUploads = fs.readdirSync(uploadsDir);
      filesInUploads.forEach(file => {
        const filePath = path.join(uploadsDir, file);
        if (!usedFiles.has(filePath)) {
          fs.unlinkSync(filePath); // Delete unused signature file
          console.log(`Deleted unused file: ${file}`);
        }
      });
  
      // Step 5: Delete the report from the database
      await Report.findOneAndDelete({ monthReport: month });
  
      res.status(200).json({ message: `Report for month ${month} deleted successfully along with associated files.` });
    } catch (error) {
      console.error('Error deleting report:', error);
      res.status(500).json({ message: 'Internal server error.' });
    }
  };





//   exports.clearAllReports = async (req, res) => {
//   try {
//     // Step 1: Get all reports before deleting
//     const reports = await Report.find({});

//     // Step 2: Collect all used file names (PDFs and signatures)
//     const filesToDelete = new Set();

//     reports.forEach(report => {
//       // Add PDF file
//       if (report.pdfFileName && !report.pdfFileName.startsWith('data:')) {
//         filesToDelete.add(path.basename(report.pdfFileName));
//       }

//       // Add all signature files from documents
//       report.reportingRemarks?.forEach(remark => {
//         remark.documents?.forEach(doc => {
//           const sig = doc.signature;
//           if (sig && !sig.startsWith('data:image')) {
//             filesToDelete.add(path.basename(sig));
//           }
//         });
//       });
//     });

//     // Step 3: Delete each collected file from the uploads folder
//     const allFiles = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
//     allFiles.forEach(file => {
//       if (filesToDelete.has(file)) {
//         const filePath = path.join(uploadsDir, file);
//         fs.unlinkSync(filePath);
//         console.log(`🗑️ Deleted file: ${file}`);
//       }
//     });

//     // Step 4: Delete all reports from the database
//     await Report.deleteMany({});

//     res.status(200).json({ message: 'All Report documents and associated files have been successfully deleted.' });
//   } catch (error) {
//     console.error('❌ Error clearing Report collection:', error);
//     res.status(500).json({ message: 'Internal server error.' });
//   }
// };



// exports.clearAllReports = async (req, res) => {
//   try {
//     // Step 1: Get all reports before deleting
//     const reports = await Report.find({});

//     reports.forEach(report => {
//       // Delete PDF file if it exists
//       const pdfFileName = report.pdfFileName;
//       if (pdfFileName && !pdfFileName.startsWith('data:')) {
//         const pdfFilePath = path.join(uploadsDir, path.basename(pdfFileName));
//         if (fs.existsSync(pdfFilePath)) {
//           fs.unlinkSync(pdfFilePath);
//           console.log(`🗑️ Deleted PDF file: ${pdfFileName}`);
//         }
//       }

//       // Delete all related signature files
//       report.reportingRemarks?.forEach(remark => {
//         remark.documents?.forEach(doc => {
//           const sig = doc.signature;
//           if (sig && !sig.startsWith('data:image')) {
//             const sigPath = path.join(uploadsDir, path.basename(sig));
//             if (fs.existsSync(sigPath)) {
//               fs.unlinkSync(sigPath);
//               console.log(`🗑️ Deleted signature file: ${sig}`);
//             }
//           }
//         });
//       });
//     });

//     // Step 2: Delete all reports from the database
//     await Report.deleteMany({});

//     res.status(200).json({ message: 'All Report documents and associated files have been successfully deleted.' });
//   } catch (error) {
//     console.error('❌ Error clearing Report collection:', error);
//     res.status(500).json({ message: 'Internal server error.' });
//   }
// };





// exports.clearAllReports = async (req, res) => {
//   try {
//     // Step 1: Get all reports before deleting
//     const reports = await Report.find({});
//     if (!reports.length) {
//       return res.status(200).json({ message: 'No reports found to delete.' });
//     }

//     // Step 2: Collect all PDF and signature file paths
//     const filesToDelete = new Set();

//     reports.forEach(report => {
//       // PDF file
//       if (report.pdfFileName && !report.pdfFileName.startsWith('data:')) {
//         filesToDelete.add(path.join(uploadsDir, path.basename(report.pdfFileName)));
//       }

//       // Signature files
//       report.reportingRemarks?.forEach(remark => {
//         remark.documents?.forEach(doc => {
//           const sig = doc.signature;
//           if (sig && !sig.startsWith('data:image')) {
//             filesToDelete.add(path.join(uploadsDir, path.basename(sig)));
//           }
//         });
//       });
//     });

//     // Step 3: Delete each collected file
//     for (const filePath of filesToDelete) {
//       if (fs.existsSync(filePath)) {
//         fs.unlinkSync(filePath);
//         console.log(`🗑️ Deleted file: ${path.basename(filePath)}`);
//       } else {
//         console.warn(`⚠️ File not found: ${path.basename(filePath)}`);
//       }
//     }

//     // Step 4: Delete all reports
//     await Report.deleteMany({});

//     res.status(200).json({ message: '✅ All reports and associated files deleted successfully.' });
//   } catch (error) {
//     console.error('❌ Error while clearing reports:', error);
//     res.status(500).json({ message: 'Internal server error.' });
//   }
// };



exports.clearAllReports = async (req, res) => {
  try {
    const reports = await Report.find({});
    if (!reports.length) {
      return res.status(200).json({ message: 'No reports found to delete.' });
    }

    const filesToDelete = new Set();

    const extractFileName = filePath => {
      if (!filePath) return null;
      try {
        const url = new URL(filePath);
        return path.basename(url.pathname);
      } catch {
        return path.basename(filePath);
      }
    };

    reports.forEach(report => {
      const pdfName = extractFileName(report.pdfFileName);
      if (pdfName) {
        filesToDelete.add(path.join(uploadsDir, pdfName));
      }

      report.reportingRemarks?.forEach(remark => {
        remark.documents?.forEach(doc => {
          const sigName = extractFileName(doc.signature);
          if (sigName && !sigName.startsWith('data:image')) {
            filesToDelete.add(path.join(uploadsDir, sigName));
          }
        });
      });
    });

    for (const filePath of filesToDelete) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted file: ${path.basename(filePath)}`);
      } else {
        console.warn(`⚠️ File not found: ${path.basename(filePath)}`);
      }
    }

    await Report.deleteMany({});
    res.status(200).json({ message: '✅ All reports and associated files deleted successfully.' });
  } catch (error) {
    console.error('❌ Error while clearing reports:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
};
 