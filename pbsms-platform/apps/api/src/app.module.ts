import { MiddlewareConsumer, Module, NestModule, Controller, Get } from '@nestjs/common';
import { DatabaseModule } from './common/database/database.module';
import { TenantMiddleware } from './common/tenant/tenant.middleware';
import { AuthorizationModule } from './common/auth/authorization.module';
import { AuthModule } from './modules/auth/auth.module';
import { StudentsModule } from './modules/students/students.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { AcademicYearsModule } from './modules/academic-years/academic-years.module';
import { ClassesModule } from './modules/classes/classes.module';
import { EnrolmentsModule } from './modules/enrolments/enrolments.module';
import { AdmissionsModule } from './modules/admissions/admissions.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AssessmentModule } from './modules/assessment/assessment.module';
import { GradingModule } from './modules/grading/grading.module';
import { ResultsModule } from './modules/results/results.module';
import { PromotionModule } from './modules/promotion/promotion.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { FinanceModule } from './modules/finance/finance.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { DisciplineModule } from './modules/discipline/discipline.module';
import { LibraryModule } from './modules/library/library.module';
import { TransportModule } from './modules/transport/transport.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { StaffModule } from './modules/staff/staff.module';
import { GuardiansModule } from './modules/guardians/guardians.module';
import { ParentViewModule } from './modules/parent-view/parent-view.module';
import { TeacherAssignmentsModule } from './modules/teacher-assignments/teacher-assignments.module';
import { PlatformStaffModule } from './modules/platform-staff/platform-staff.module';
import { ImpersonationModule } from './modules/impersonation/impersonation.module';
import { BillingModule } from './modules/billing/billing.module';
import { DelegationsModule } from './modules/delegations/delegations.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DataProtectionModule } from './modules/data-protection/data-protection.module';
import { NaccaModule } from './modules/nacca/nacca.module';
import { TimetableModule } from './modules/timetable/timetable.module';
import { TimelineModule } from './modules/timeline/timeline.module';
import { StaffFeedbackModule } from './modules/staff-feedback/staff-feedback.module';
import { TenantApplicationsModule } from './modules/tenant-applications/tenant-applications.module';

@Controller()
class HealthController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    DatabaseModule,
    AuthorizationModule,
    AuthModule,
    StudentsModule,
    SchoolsModule,
    TenantsModule,
    AcademicYearsModule,
    ClassesModule,
    EnrolmentsModule,
    AdmissionsModule,
    AttendanceModule,
    AssessmentModule,
    GradingModule,
    ResultsModule,
    PromotionModule,
    DocumentsModule,
    FinanceModule,
    CommunicationModule,
    DisciplineModule,
    LibraryModule,
    TransportModule,
    HealthModule,
    InventoryModule,
    StaffModule,
    GuardiansModule,
    ParentViewModule,
    TeacherAssignmentsModule,
    PlatformStaffModule,
    ImpersonationModule,
    BillingModule,
    DelegationsModule,
    JobsModule,
    AnalyticsModule,
    DataProtectionModule,
    NaccaModule,
    TimetableModule,
    TimelineModule,
    StaffFeedbackModule,
    TenantApplicationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Applied to every route. This is what makes FR-API-030 ("there is no
    // code path in which a handler can be reached without a resolved
    // tenant") true — it is a property of how routing is wired here, not
    // a promise kept by each controller individually.
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
