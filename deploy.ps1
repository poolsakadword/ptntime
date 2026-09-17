# ==============================================================================
# PTN Time Attendant - Deployment Script for Cloudflare Pages (ptntime.pages.dev)
# บริษัท พีทีเอ็น ฟาร์มาเซ็นเตอร์ จำกัด
# ==============================================================================

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
$env:PATH = "C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;C:\Program Files\nodejs;" + $env:PATH

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  PTN Time Attendant (ptntime.pages.dev)" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "1. Deploy to Cloudflare Pages (ptntime.pages.dev)"
Write-Host "2. Commit & Push to GitHub"
Write-Host "3. Local Dev Server (Wrangler Pages Dev)"
Write-Host "4. Exit"
Write-Host "========================================================" -ForegroundColor Cyan

$choice = Read-Host "เลือกตัวเลือก (1, 2, 3 หรือ 4)"

if ($choice -eq "1") {
    Write-Host "`n[1/2] กำลังเตรียมการ Deploy ไปยัง Cloudflare Pages (ptntime)..." -ForegroundColor Green
    npx wrangler pages deploy public --project-name=ptntime
    Write-Host "`n[2/2] การ Deploy ไปยัง https://ptntime.pages.dev เสร็จสิ้นเรียบร้อย!" -ForegroundColor Green
}
elseif ($choice -eq "2") {
    Write-Host "`nกำลังบันทึกการเปลี่ยนแปลงใน Git..." -ForegroundColor Green
    git add .
    git commit -m "feat: complete PTN Time Attendant mobile app"
    git push
    Write-Host "บันทึกข้อมูลเรียบร้อย!" -ForegroundColor Green
}
elseif ($choice -eq "3") {
    Write-Host "`nเริ่ม Local Dev Server..." -ForegroundColor Green
    npx wrangler pages dev public --d1=DB=ptn_payroll_db
}
else {
    Write-Host "ออกจากการทำงาน" -ForegroundColor Gray
}
