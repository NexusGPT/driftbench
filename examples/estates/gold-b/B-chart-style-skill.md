---
name: chart-style
description: Draws charts for client reports in the firm's style. Use when a request asks for a chart, a graph or a picture of the numbers.
---

# Chart style

A chart is worth drawing only when it answers a question faster than a table. Most clients want three kinds: a bar for months, a line for a balance and a column pair for this year against last year.

## Choosing the chart

Ask what the reader should see before you pick the kind. Write the question in one sentence at the top of your script.

| The reader wants to see | Draw |
|---|---|
| Which month was biggest | A bar chart, one bar per month |
| How the balance moved | A line chart with the zero line marked |
| This year against last year | Paired columns, same colours every time |
| Shares of a total | A single stacked bar, never a pie |

## Style

Use the firm's palette: dark blue for this period, grey for the comparison, orange only for the one thing to look at. Do not use more than three colours in one chart.

Label the axes in words with the unit, such as euros or number of sales. Start bar charts at zero. A bar chart that starts above zero tells a false story.

Write the chart title as the finding, not the topic. Use a title such as sales rose in July and not a title such as monthly sales.

## Size and file

Draw the chart at 1600 by 900 pixels and save it as a png. Use 150 dots per inch.

Example call: `fig.set_size_inches(10.67, 6) fig.savefig(out_path, dpi=150, bbox_inches="tight")`.

Save the chart in the output folder next to the file it belongs to. Use the same naming pattern, with chart as the subject.

## Fonts

The sandbox has two fonts that always work, a sans serif and a monospace. Use the sans serif. A font that is not installed falls back silently and changes the look.

## Checking the picture

Open the finished png and look at it before you say it is done. Check that no label is cut off and that the legend does not hide a bar.

Describe in one sentence what the chart shows. If your sentence does not match the title, redraw the chart.

## What not to draw

Do not draw a chart for fewer than four numbers; write them in a sentence. Do not draw three dimensional charts or shadows. Do not draw a second axis unless a partner asked for it.

## Accessibility

Some clients print in black and white. Make sure the bars differ in shade as well as in colour.

Add the numbers on top of the bars when there are twelve bars or fewer.

Enjoy the drawing.
