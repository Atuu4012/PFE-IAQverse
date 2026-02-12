import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'
import { useThemeStore } from '../../stores/themeStore'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

export default function IAQChart({ data = [] }) {
  const { theme } = useThemeStore()
  
  const isDark = theme === 'dark'
  const textColor = isDark ? '#f1f5f9' : '#1a202c'
  const gridColor = isDark ? '#334155' : '#e2e8f0'

  const chartData = {
    labels: data.map(d => d.time || d.label),
    datasets: [
      {
        label: 'Score IAQ',
        data: data.map(d => d.iaq_score || d.value),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
      }
    ]
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: textColor,
          font: {
            family: 'Inter',
            size: 12,
            weight: 500,
          },
          padding: 15,
        }
      },
      tooltip: {
        backgroundColor: isDark ? '#1e293b' : '#ffffff',
        titleColor: textColor,
        bodyColor: textColor,
        borderColor: gridColor,
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        callbacks: {
          label: (context) => {
            return `${context.dataset.label}: ${context.parsed.y.toFixed(0)}/100`
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: gridColor,
          drawBorder: false,
        },
        ticks: {
          color: textColor,
          font: {
            size: 11,
          }
        }
      },
      y: {
        min: 0,
        max: 100,
        grid: {
          color: gridColor,
          drawBorder: false,
        },
        ticks: {
          color: textColor,
          font: {
            size: 11,
          },
          stepSize: 20,
        }
      }
    },
    interaction: {
      intersect: false,
      mode: 'index',
    }
  }

  return <Line data={chartData} options={options} />
}
