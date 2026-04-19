import { Routes } from '@angular/router';
import { adminGuard } from './guards/admin.guard';
import { authGuard } from './guards/auth.guard';
import { DashboardComponent } from './dashboard/dashboard.component';
import { LoginComponent } from './login/login.component';
import { NetworkComponent } from './network/network.component';
import { ProfileComponent } from './profile/profile.component';
import { RegisterComponent } from './register/register.component';
import { SimulatorComponent } from './simulator/simulator.component';
import { UsersComponent } from './users/users.component';

export const routes: Routes = [
  { path: '',          pathMatch: 'full', redirectTo: 'login' },
  { path: 'login',     component: LoginComponent },
  { path: 'register',  component: RegisterComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'simulator', component: SimulatorComponent, canActivate: [authGuard] },
  { path: 'profile',   component: ProfileComponent,   canActivate: [authGuard] },
  { path: 'users',     component: UsersComponent,     canActivate: [adminGuard] },
  { path: 'network',   component: NetworkComponent,   canActivate: [authGuard] },
];
