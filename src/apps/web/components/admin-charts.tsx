"use client"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const neutralChartConfig = {
  value: {
    label: "Value",
    color: "var(--chart-2)",
  },
  secondary: {
    label: "Secondary",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

export function AdminAreaChart({
  data,
  valueLabel = "Value",
}: {
  data: Array<{ label: string; value: number }>
  valueLabel?: string
}) {
  return (
    <ChartContainer
      config={{
        value: {
          label: valueLabel,
          color: "var(--chart-2)",
        },
      }}
      className="aspect-auto h-64 w-full"
    >
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 10 }}>
        <defs>
          <linearGradient id="admin-area-value" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-value)"
              stopOpacity={0.28}
            />
            <stop
              offset="95%"
              stopColor="var(--color-value)"
              stopOpacity={0.02}
            />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis hide />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--color-value)"
          fill="url(#admin-area-value)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  )
}

export function AdminBarChart({
  data,
  valueLabel = "Value",
}: {
  data: Array<{ label: string; value: number }>
  valueLabel?: string
}) {
  return (
    <ChartContainer
      config={{
        value: {
          label: valueLabel,
          color: "var(--chart-2)",
        },
      }}
      className="aspect-auto h-64 w-full"
    >
      <BarChart data={data} margin={{ left: 0, right: 8, top: 10 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis hide />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={[5, 5, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

export function AdminStackedBarChart({
  data,
}: {
  data: Array<{ label: string; value: number; secondary: number }>
}) {
  return (
    <ChartContainer
      config={neutralChartConfig}
      className="aspect-auto h-64 w-full"
    >
      <BarChart data={data} margin={{ left: 0, right: 8, top: 10 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis hide />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey="value"
          stackId="a"
          fill="var(--color-value)"
          radius={[0, 0, 4, 4]}
        />
        <Bar
          dataKey="secondary"
          stackId="a"
          fill="var(--color-secondary)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  )
}

export function AdminDonutChart({
  data,
}: {
  data: Array<{ label: string; value: number; color?: string }>
}) {
  const safeData = data.some((item) => item.value > 0)
    ? data
    : [{ label: "No data", value: 1, color: "var(--muted)" }]

  return (
    <ChartContainer
      config={{
        value: { label: "Count", color: "var(--chart-2)" },
      }}
      className="mx-auto aspect-square h-52 w-full max-w-80"
    >
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie
          data={safeData}
          dataKey="value"
          nameKey="label"
          innerRadius={58}
          outerRadius={82}
          paddingAngle={3}
        >
          {safeData.map((entry, index) => (
            <Cell
              key={entry.label}
              fill={entry.color || `var(--chart-${(index % 5) + 1})`}
            />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  )
}
