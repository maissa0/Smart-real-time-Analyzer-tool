import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Client, IMessage } from '@stomp/stompjs';

interface AnomalyAlert {
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  frame_id: string;
  detail: string;
  timestamp: number;
  source: string;
  signal?: string;
  anomaly_score?: number;
}

@Component({
  selector: 'app-anomaly-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './anomaly-panel.component.html',
  styleUrls: ['./anomaly-panel.component.css']
})
export class AnomalyPanelComponent implements OnInit, OnDestroy {
  alerts: AnomalyAlert[] = [];
  unreadCount = 0;
  isExpanded = true;
  private stompClient: Client | null = null;

  ngOnInit(): void {
    this.stompClient = new Client({
      brokerURL: 'ws://localhost:8082/ws/websocket',
      reconnectDelay: 5000,
    });

    this.stompClient.onConnect = () => {
      this.stompClient!.subscribe('/topic/anomalies', (msg: IMessage) => {
        try {
          const alert: AnomalyAlert = JSON.parse(msg.body);
          this.alerts.unshift(alert);
          if (this.alerts.length > 100) this.alerts.pop();
          if (!this.isExpanded) this.unreadCount++;
        } catch (e) {
          console.error('Failed to parse anomaly alert', e);
        }
      });
    };

    this.stompClient.activate();
  }

  ngOnDestroy(): void {
    this.stompClient?.deactivate();
  }

  toggle(): void {
    this.isExpanded = !this.isExpanded;
    if (this.isExpanded) this.unreadCount = 0;
  }

  dismiss(index: number): void {
    this.alerts.splice(index, 1);
  }

  clearAll(): void {
    this.alerts = [];
    this.unreadCount = 0;
  }

  severityClass(severity: string): string {
    const map: Record<string, string> = {
      'CRITICAL': 'severity-critical',
      'HIGH':     'severity-high',
      'MEDIUM':   'severity-medium',
      'LOW':      'severity-low',
    };
    return map[severity] || 'severity-low';
  }

  formatTime(ts: number): string {
    return new Date(ts * 1000).toLocaleTimeString();
  }
}
